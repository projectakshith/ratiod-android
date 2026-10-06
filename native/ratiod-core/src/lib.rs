//! Device-local SRM application core. No HTTP listener or credential persistence.
pub mod academia;
pub mod academic_parsers;
pub mod contract;
pub mod core;
pub mod error;
pub mod models;
pub mod parsers;
pub mod portal;
pub mod portal_parsers;
pub mod transport;
pub use core::Core;
