//! Hold Apple's file coordinator across a complete Rust read or save.
//!
//! This does not validate Forge membership or download readiness. The caller
//! must do both inside the accessor, using the returned coordinated path.
//! Keep hash checks, conflict preservation and atomic replacement together in
//! a single write accessor, not in separate independently coordinated calls.

use std::ffi::{c_char, c_void, CStr, CString, OsStr};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

extern "C" {
    fn moldavite_coordinate_file(
        path: *const c_char,
        writing: bool,
        context: *mut c_void,
        accessor: extern "C" fn(*mut c_void, *const c_char, *const c_char),
    );
}

struct Accessor<F, T> {
    operation: Option<F>,
    result: Option<std::thread::Result<Result<T, String>>>,
}

extern "C" fn access<F, T>(context: *mut c_void, path: *const c_char, error: *const c_char)
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    // SAFETY: coordinate passes a live, uniquely borrowed Accessor<F, T>. The
    // native function invokes this synchronously and retains no pointers.
    let state = unsafe { &mut *context.cast::<Accessor<F, T>>() };
    state.result = Some(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || {
            if !error.is_null() {
                // SAFETY: Swift lends a NUL-terminated string for this callback.
                return Err(unsafe { CStr::from_ptr(error) }
                    .to_string_lossy()
                    .into_owned());
            }
            if path.is_null() {
                return Err("The file coordinator returned no path".to_string());
            }
            // SAFETY: Swift lends a NUL-terminated path until this callback returns.
            let path = Path::new(OsStr::from_bytes(
                unsafe { CStr::from_ptr(path) }.to_bytes(),
            ));
            let operation = state
                .operation
                .take()
                .ok_or("The file coordinator invoked its accessor twice")?;
            operation(path)
        },
    )));
}

fn coordinate<T, F>(path: &Path, writing: bool, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    if !path.is_absolute() {
        return Err("Coordinated file access requires an absolute path".to_string());
    }
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "File path contains a NUL byte".to_string())?;
    let mut state = Accessor {
        operation: Some(operation),
        result: None,
    };
    // SAFETY: path and state outlive the synchronous native call. The generic
    // callback matches the state type; Swift does not retain either pointer.
    unsafe {
        moldavite_coordinate_file(
            path.as_ptr(),
            writing,
            (&mut state as *mut Accessor<F, T>).cast(),
            access::<F, T>,
        );
    }
    match state.result {
        Some(Ok(result)) => result,
        // Resume only after returning from Swift and releasing coordination.
        Some(Err(panic)) => std::panic::resume_unwind(panic),
        None => Err("The file coordinator did not run its accessor".to_string()),
    }
}

pub fn read<T, F>(path: &Path, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    coordinate(path, false, operation)
}

pub fn write<T, F>(path: &Path, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    coordinate(path, true, operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT_ID: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "moldavite-coordination-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            Self(root.canonicalize().unwrap())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn coordinated_save_preserves_an_external_edit_before_atomic_replacement() {
        let fixture = Fixture::new();
        let path = fixture.0.join("note.md");
        fs::write(&path, "external edit").unwrap();
        let conflict = fixture.0.join("note (conflict).md");
        write(&path, |coordinated| {
            let old = fs::read(coordinated).map_err(|e| e.to_string())?;
            fs::write(&conflict, old).map_err(|e| e.to_string())?;
            let temporary = fixture.0.join("temporary.md");
            fs::write(&temporary, "my edit").map_err(|e| e.to_string())?;
            fs::rename(temporary, coordinated).map_err(|e| e.to_string())
        })
        .unwrap();
        assert_eq!(fs::read_to_string(conflict).unwrap(), "external edit");
        assert_eq!(
            read(&path, |p| fs::read_to_string(p).map_err(|e| e.to_string())).unwrap(),
            "my edit"
        );
    }

    #[test]
    fn a_second_writer_waits_for_the_entire_first_accessor() {
        let fixture = Fixture::new();
        let path = fixture.0.join("note.md");
        fs::write(&path, "initial").unwrap();
        let (held_tx, held_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let (entered_tx, entered_rx) = mpsc::channel();
        let first_path = path.clone();
        let first = std::thread::spawn(move || {
            write(&first_path, move |p| {
                held_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                fs::write(p, "first").map_err(|e| e.to_string())
            })
        });
        held_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let second = std::thread::spawn(move || {
            waiting_tx.send(()).unwrap();
            write(&path, |p| {
                entered_tx.send(()).unwrap();
                fs::read_to_string(p).map_err(|e| e.to_string())
            })
        });
        waiting_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(entered_rx.recv_timeout(Duration::from_millis(100)).is_err());
        release_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
        assert_eq!(second.join().unwrap().unwrap(), "first");
    }

    #[test]
    fn errors_and_panics_release_coordination_without_crossing_the_ffi_boundary() {
        let fixture = Fixture::new();
        let path = fixture.0.join("note.md");
        fs::write(&path, "keep").unwrap();
        assert_eq!(
            write::<(), _>(&path, |_| Err("save failed".to_string())),
            Err("save failed".to_string())
        );
        assert!(std::panic::catch_unwind(|| {
            let _ = write::<(), _>(&path, |_| panic!("test panic"));
        })
        .is_err());
        assert_eq!(read(&path, |_| Ok(42)).unwrap(), 42);
        assert_eq!(fs::read_to_string(path).unwrap(), "keep");
    }
}
