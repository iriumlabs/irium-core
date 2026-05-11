fn main() {
    tauri_build::build();

    // Capture the irium-source submodule HEAD commit at build time.
    // Embedded as IRIUM_NODE_COMMIT so the running app knows which source
    // version its node binaries were compiled from and can compare against
    // the latest commit on GitHub to detect available updates.
    let commit = std::process::Command::new("git")
        .args(["-C", "../irium-source", "rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() == 40)
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=IRIUM_NODE_COMMIT={}", commit);
    // Rerun this script when the submodule HEAD changes.
    println!("cargo:rerun-if-changed=../irium-source/.git/HEAD");
    println!("cargo:rerun-if-changed=../.gitmodules");
}
