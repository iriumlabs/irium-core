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

    // Hash the bundled iriumd for THIS target at build time.
    //
    // WHY A HASH AND NOT A VERSION STRING. The node's `--version` reflects its Cargo.toml,
    // which lags real builds: the binary deployed to mainnet as "iriumd-v1.9.192-9634508b"
    // and the binary bundled here BOTH report "iriumd version 1.9.158". A version-string
    // comparison therefore cannot distinguish a current sidecar from a stale one, and an
    // earlier draft of this check would have flagged EVERY user as stale.
    //
    // A hash is derived from the actual shipped bytes, so it cannot drift out of sync with
    // reality and cannot be forgotten on a release the way a hand-typed constant can.
    let target = std::env::var("TARGET").unwrap_or_default();
    let suffix = if target.contains("windows") { ".exe" } else { "" };
    let bundled = format!("binaries/iriumd-{}{}", target, suffix);
    let node_sha = std::fs::read(&bundled)
        .map(|bytes| {
            use sha2::{Digest, Sha256};
            hex::encode(Sha256::digest(&bytes))
        })
        // Empty means "unknown" -> the runtime check DISABLES itself rather than guessing.
        .unwrap_or_default();
    println!("cargo:rustc-env=EXPECTED_NODE_SHA256={}", node_sha);
    println!("cargo:rerun-if-changed={}", bundled);

    println!("cargo:rustc-env=IRIUM_NODE_COMMIT={}", commit);
    // Rerun this script when the submodule HEAD changes.
    println!("cargo:rerun-if-changed=../irium-source/.git/HEAD");
    println!("cargo:rerun-if-changed=../.gitmodules");
}
