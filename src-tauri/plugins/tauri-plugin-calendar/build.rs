use std::path::{Path, PathBuf};
use std::process::Command;

// SwiftRs runtime entry points Tauri's Rust side calls. Every plugin archive
// carries its own copy of SwiftRs.o.
const SWIFT_RS_EXPORTS: [&str; 4] = [
    "_retain_object",
    "_release_object",
    "_string_from_bytes",
    "_data_from_bytes",
];

fn main() {
    // The builder watches only `ios/`; the EventKit bridge it links lives outside it.
    println!("cargo:rerun-if-changed=../../src-swift/Sources");
    println!("cargo:rerun-if-changed=../../src-swift/Package.swift");
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        export_swift_rs_runtime();
    }
}

/// Xcode 27's SwiftPM makes @_cdecl symbols local in release archives, and
/// swift-rs 1.0.8 only restores those of each package's own module, so no
/// archive exports the shared SwiftRs ones. Export them from this archive
/// alone: a second global copy makes Xcode 27's ld reject the link.
fn export_swift_rs_runtime() {
    let Some(archive) = plugin_archive() else {
        return;
    };
    let Ok(nm) = Command::new("nm").arg(&archive).output() else {
        return;
    };
    let listing = String::from_utf8_lossy(&nm.stdout);
    let local: Vec<&str> = SWIFT_RS_EXPORTS
        .into_iter()
        .filter(|symbol| {
            listing
                .lines()
                .any(|line| line.ends_with(&format!(" t {symbol}")))
        })
        .collect();
    if local.is_empty() {
        return;
    }
    let Some(objcopy) = llvm_objcopy() else {
        println!("cargo:warning=llvm-objcopy not found; run `rustup component add llvm-tools`");
        return;
    };
    let status = Command::new(objcopy)
        .args(
            local
                .iter()
                .map(|symbol| format!("--globalize-symbol={symbol}")),
        )
        .arg(&archive)
        .status();
    if !status.is_ok_and(|status| status.success()) {
        println!(
            "cargo:warning=could not export the SwiftRs runtime from {}",
            archive.display()
        );
    }
}

fn plugin_archive() -> Option<PathBuf> {
    let package = Path::new(&std::env::var("OUT_DIR").ok()?).join("swift-rs/tauri-plugin-calendar");
    ["release", "debug"]
        .into_iter()
        .map(|config| package.join(config).join("libtauri-plugin-calendar.a"))
        .find(|archive| archive.exists())
}

fn llvm_objcopy() -> Option<PathBuf> {
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let sysroot = Command::new(rustc)
        .args(["--print", "sysroot"])
        .output()
        .ok()?;
    let host = std::env::var("HOST").ok()?;
    let path = Path::new(String::from_utf8_lossy(&sysroot.stdout).trim())
        .join("lib/rustlib")
        .join(host)
        .join("bin/llvm-objcopy");
    path.exists().then_some(path)
}
