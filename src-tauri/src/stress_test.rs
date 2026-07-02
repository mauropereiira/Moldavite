//! Stress tests: large-vault search, concurrent atomic writes, and bulk
//! wiki-link rewriting. These use generous time bounds so they stay green on
//! slow CI machines while still catching order-of-magnitude regressions.
#![cfg(test)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::commands::search::search_notes_content_in;
use crate::persist::write_atomic;
use crate::wiki::rewrite_links_for_rename;

struct TempVault(PathBuf);

impl TempVault {
    fn new(tag: &str) -> Self {
        let base = std::env::temp_dir().join(format!(
            "moldavite-stress-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        for sub in ["notes", "notes/Projects", "daily", "weekly"] {
            fs::create_dir_all(base.join(sub)).unwrap();
        }
        Self(base)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempVault {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn lorem_note(i: usize, with_needle: bool) -> String {
    let mut s = format!("# Note {i}\n\n");
    for para in 0..8 {
        s.push_str(&format!(
            "Paragraph {para} of note {i}: the slow amber fox considers \
             [[note-{}]] and drifts along the ridge line without hurry.\n\n",
            (i + para) % 1000
        ));
    }
    if with_needle {
        s.push_str("This one mentions the moldavite-needle exactly once.\n");
    }
    s
}

#[test]
fn stress_search_over_1000_note_vault() {
    let vault = TempVault::new("search");
    let base = vault.path();

    for i in 0..1000 {
        let dir = if i % 5 == 0 { "notes/Projects" } else { "notes" };
        let content = lorem_note(i, i % 100 == 0); // 10 notes carry the needle
        fs::write(base.join(dir).join(format!("note-{i}.md")), content).unwrap();
    }

    let started = Instant::now();
    let results = search_notes_content_in(base, &base.join(".trash"), "moldavite-needle", 50);
    let elapsed = started.elapsed();

    assert_eq!(results.len(), 10, "expected exactly the 10 seeded matches");
    eprintln!("[stress] search over 1000 notes took {elapsed:?}");
    assert!(
        elapsed.as_secs() < 5,
        "search over 1000 notes took {elapsed:?} — order-of-magnitude regression"
    );
}

#[test]
fn stress_atomic_writes_concurrent_distinct_files() {
    let vault = TempVault::new("atomic-distinct");
    let base = vault.path().join("notes");

    let started = Instant::now();
    std::thread::scope(|scope| {
        for t in 0..8 {
            let base = base.clone();
            scope.spawn(move || {
                for i in 0..100 {
                    let path = base.join(format!("t{t}-n{i}.md"));
                    let body = format!("thread {t} note {i}\n{}", "x".repeat(512));
                    write_atomic(&path, body.as_bytes(), Some(0o600)).unwrap();
                }
            });
        }
    });
    eprintln!("[stress] 800 concurrent atomic writes took {:?}", started.elapsed());

    let mut count = 0;
    for entry in fs::read_dir(&base).unwrap().flatten() {
        if !entry.path().is_file() {
            continue;
        }
        let content = fs::read_to_string(entry.path()).unwrap();
        assert!(content.starts_with("thread "), "torn or empty file: {:?}", entry.path());
        count += 1;
    }
    assert_eq!(count, 800);
}

#[test]
fn stress_atomic_writes_same_file_never_torn() {
    let vault = TempVault::new("atomic-same");
    let path = vault.path().join("notes").join("contended.md");

    // Two full payloads of different lengths; a torn write would produce a
    // file matching neither.
    let a = format!("AAAA {}\n", "a".repeat(4096));
    let b = format!("BB {}\n", "b".repeat(9000));

    std::thread::scope(|scope| {
        let (path_a, payload_a) = (path.clone(), a.clone());
        scope.spawn(move || {
            for _ in 0..150 {
                write_atomic(&path_a, payload_a.as_bytes(), None).unwrap();
            }
        });
        let (path_b, payload_b) = (path.clone(), b.clone());
        scope.spawn(move || {
            for _ in 0..150 {
                write_atomic(&path_b, payload_b.as_bytes(), None).unwrap();
            }
        });
    });

    let final_content = fs::read_to_string(&path).unwrap();
    assert!(
        final_content == a || final_content == b,
        "file is torn: {} bytes, expected {} or {}",
        final_content.len(),
        a.len(),
        b.len()
    );

    // No stray temp files left behind.
    let leftovers: Vec<_> = fs::read_dir(vault.path().join("notes"))
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
}

#[test]
fn stress_rewrite_links_across_large_corpus() {
    // 500 notes, each with 9 links; rewrite one target across all of them.
    let corpus: Vec<String> = (0..500).map(|i| lorem_note(i, false)).collect();

    let started = Instant::now();
    let mut touched = 0;
    for content in &corpus {
        if let Some(rewritten) = rewrite_links_for_rename(content, "note-42", "renamed-note") {
            assert!(rewritten.contains("[[renamed-note]]"));
            assert!(!rewritten.contains("[[note-42]]"));
            touched += 1;
        }
    }
    eprintln!(
        "[stress] link rewrite across 500 notes took {:?} ({touched} touched)",
        started.elapsed()
    );
    // note i links to (i+para)%1000 for para 0..8 — several notes link to 42.
    assert!(touched > 0, "expected at least one note to link to note-42");
    assert!(started.elapsed().as_secs() < 5);
}
