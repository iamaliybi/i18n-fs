//! Build script: makes the stamped version a rebuild trigger.
//!
//! Cargo does not track an environment variable a crate reads unless it is told
//! to. Without this, bumping the npm version and rebuilding would silently
//! reuse the previously compiled binary and bake the old string in — a worse
//! failure than the one the version check exists to catch, because it would
//! make the check itself lie.

// A build script is not API; the crate's `missing_docs` does not apply usefully
// to its `main`.
#![allow(missing_docs)]

fn main() {
	println!("cargo:rerun-if-env-changed=I18N_FS_VERSION");
}
