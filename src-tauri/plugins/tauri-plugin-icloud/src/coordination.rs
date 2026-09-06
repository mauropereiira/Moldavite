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
    fn moldavite_access_transaction(
        requests: *const c_char,
        force_coordination: bool,
        context: *mut c_void,
        accessor: extern "C" fn(*mut c_void, *const c_char, *const c_char) -> bool,
    );
    #[cfg(target_os = "macos")]
    fn moldavite_connect_cloud(
        context: *mut c_void,
        accessor: extern "C" fn(*mut c_void, *const c_char, *const c_char),
        on_change: extern "C" fn(*const c_char),
    );
    fn moldavite_cloud_root(
        context: *mut c_void,
        accessor: extern "C" fn(*mut c_void, *const c_char, *const c_char),
    );
    fn moldavite_access_file(
        path: *const c_char,
        writing: bool,
        context: *mut c_void,
        accessor: extern "C" fn(*mut c_void, *const c_char, *const c_char),
    );
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

fn coordinate<T, F>(path: &Path, writing: bool, cloud_only: bool, operation: F) -> Result<T, String>
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
        let native = if cloud_only {
            moldavite_access_file
        } else {
            moldavite_coordinate_file
        };
        native(
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

#[cfg(any(test, target_os = "ios"))]
pub fn read<T, F>(path: &Path, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    coordinate(path, false, false, operation)
}

#[cfg(any(test, target_os = "ios"))]
pub fn write<T, F>(path: &Path, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    coordinate(path, true, false, operation)
}

type RootAccessor = Accessor<fn(&Path) -> Result<std::path::PathBuf, String>, std::path::PathBuf>;

fn receive_root(
    call: impl FnOnce(*mut c_void, extern "C" fn(*mut c_void, *const c_char, *const c_char)),
) -> Result<std::path::PathBuf, String> {
    let mut state = RootAccessor {
        operation: Some(|path| Ok(path.to_path_buf())),
        result: None,
    };
    call(
        (&mut state as *mut RootAccessor).cast(),
        access::<fn(&Path) -> Result<std::path::PathBuf, String>, std::path::PathBuf>,
    );
    match state.result {
        Some(Ok(result)) => result,
        Some(Err(panic)) => std::panic::resume_unwind(panic),
        None => Err("iCloud did not return a Forge location".to_string()),
    }
}

pub fn cloud_root() -> Result<std::path::PathBuf, String> {
    // SAFETY: the getter borrows the live accessor for this synchronous call.
    receive_root(|context, callback| unsafe { moldavite_cloud_root(context, callback) })
}

#[cfg(target_os = "macos")]
pub fn connect_cloud(
    on_change: extern "C" fn(*const c_char),
) -> Result<std::path::PathBuf, String> {
    // SAFETY: only the static change function is retained; context and its
    // callback are used synchronously until the initial query has completed.
    receive_root(|context, callback| unsafe {
        moldavite_connect_cloud(context, callback, on_change)
    })
}

/// Direct for local files; coordinated and download-checked for iCloud files.
pub fn read_cloud<T, F>(path: &Path, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    coordinate(path, false, true, operation)
}

pub fn write_cloud<T, F>(path: &Path, operation: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String> + Send,
    T: Send,
{
    coordinate(path, true, true, operation)
}

extern "C" fn transaction_access<F, T>(
    context: *mut c_void,
    paths: *const c_char,
    error: *const c_char,
) -> bool
where
    F: FnOnce(&[std::path::PathBuf]) -> Result<T, String> + Send,
    T: Send,
{
    // SAFETY: native coordination finishes this callback before returning;
    // no native code retains the uniquely borrowed state or its operation.
    let state = unsafe { &mut *context.cast::<Accessor<F, T>>() };
    state.result = Some(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || {
            if !error.is_null() {
                return Err(unsafe { CStr::from_ptr(error) }
                    .to_string_lossy()
                    .into_owned());
            }
            if paths.is_null() {
                return Err("The file coordinator returned no paths".into());
            }
            let paths: Vec<std::path::PathBuf> =
                serde_json::from_slice(unsafe { CStr::from_ptr(paths) }.to_bytes())
                    .map_err(|error| error.to_string())?;
            let operation = state
                .operation
                .take()
                .ok_or("The file coordinator invoked its accessor twice")?;
            operation(&paths)
        },
    )));
    matches!(state.result, Some(Ok(Ok(_))))
}

/// Internal JSON describes all read/write/move/delete intents in one request.
/// The callback receives Foundation's current paths and runs exactly once.
pub fn transaction<T, F>(
    requests: &str,
    force_coordination: bool,
    operation: F,
) -> Result<T, String>
where
    F: FnOnce(&[std::path::PathBuf]) -> Result<T, String> + Send,
    T: Send,
{
    let requests = CString::new(requests).map_err(|error| error.to_string())?;
    let mut state = Accessor {
        operation: Some(operation),
        result: None,
    };
    // SAFETY: the native call waits for its accessor, retaining no pointers
    // after returning. A panic is captured until coordination is released.
    unsafe {
        moldavite_access_transaction(
            requests.as_ptr(),
            force_coordination,
            (&mut state as *mut Accessor<F, T>).cast(),
            transaction_access::<F, T>,
        );
    }
    match state.result {
        Some(Ok(result)) => result,
        Some(Err(panic)) => std::panic::resume_unwind(panic),
        None => Err("The file coordinator did not run its accessor".into()),
    }
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
    #[test]
    fn transaction_can_reserve_a_new_note_and_its_absent_locked_counterpart() {
        let fixture = Fixture::new();
        let note = fixture.0.join("new.md");
        let locked = fixture.0.join("new.md.locked");
        let requests = serde_json::json!([
            {"path": note, "mode": "write"}, {"path": locked, "mode": "write"},
        ])
        .to_string();
        transaction(&requests, true, |paths| {
            assert!(!paths[0].exists());
            assert!(!paths[1].exists());
            fs::write(&paths[0], "new note").map_err(|error| error.to_string())
        })
        .unwrap();
        assert_eq!(fs::read_to_string(note).unwrap(), "new note");
        assert!(!locked.exists());
    }

    #[test]
    fn transaction_coordinates_a_move_and_propagates_failures() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source.md");
        let destination = fixture.0.join("destination.md");
        fs::write(&source, "keep every byte").unwrap();
        let requests = serde_json::json!([
            {"path": source, "mode": "move", "moveTo": 1},
            {"path": destination, "mode": "write"},
        ])
        .to_string();
        assert_eq!(
            transaction::<(), _>(&requests, true, |_| Err("cancelled".into())),
            Err("cancelled".into())
        );
        assert!(source.exists());
        assert!(!destination.exists());
        assert!(std::panic::catch_unwind(|| {
            let _ = transaction::<(), _>(&requests, true, |_| panic!("transaction panic"));
        })
        .is_err());
        transaction(&requests, true, |paths| {
            assert_eq!(paths, &[source.clone(), destination.clone()]);
            fs::rename(&paths[0], &paths[1]).map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(destination).unwrap(), "keep every byte");
    }

    #[test]
    fn transaction_reserves_the_destination_until_the_accessor_finishes() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source.md");
        let destination = fixture.0.join("destination.md");
        fs::write(&source, "source").unwrap();
        fs::write(&destination, "original destination").unwrap();
        let requests = serde_json::json!([
            {"path": source, "mode": "read"}, {"path": destination, "mode": "write"},
        ])
        .to_string();
        let (held_tx, held_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let (entered_tx, entered_rx) = mpsc::channel();
        let first = std::thread::spawn(move || {
            transaction(&requests, true, move |paths| {
                held_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                fs::write(&paths[1], "transaction completed").map_err(|error| error.to_string())
            })
        });
        held_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let second = std::thread::spawn(move || {
            waiting_tx.send(()).unwrap();
            write(&destination, |path| {
                entered_tx.send(()).unwrap();
                fs::read_to_string(path).map_err(|error| error.to_string())
            })
        });
        waiting_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(entered_rx.recv_timeout(Duration::from_millis(100)).is_err());
        release_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
        assert_eq!(second.join().unwrap().unwrap(), "transaction completed");
    }

    #[test]
    fn transaction_refuses_a_pending_destination_before_touching_the_source() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source.md");
        let destination = fixture.0.join("destination.md");
        let placeholder = fixture.0.join(".destination.md.icloud");
        fs::write(&source, "source").unwrap();
        fs::write(&placeholder, "remote metadata").unwrap();
        let requests = serde_json::json!([
            {"path": source, "mode": "move", "moveTo": 1}, {"path": destination, "mode": "write"},
        ])
        .to_string();
        assert!(
            transaction::<(), _>(&requests, false, |_| panic!("must not enter"))
                .unwrap_err()
                .contains("download")
        );
        assert_eq!(fs::read_to_string(source).unwrap(), "source");
        assert!(!destination.exists());
        assert!(placeholder.exists());
    }
}
