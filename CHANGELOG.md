# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-11
### Added
- Initial public release
- 14 browser tools: open, goto, find, click, type, press, extract, read, list, select, check, wait, upload, dialog, screenshot, eval, scroll
- Real-user mode: smooth scrollIntoView, hover dwell 200-400ms, random human delays 80-700ms, visible-only extracts, pressSequentially typing
- Frame support (`frame: "iframe#a >> iframe#b"`), Shadow DOM piercing (open roots), nth disambiguation
- Dialog capture (alert/confirm/prompt) with accept/dismiss toggle
- Upload guard via PI_UPLOAD_DIR (defaults to cwd)
- Persistent profile via PI_BROWSER_PROFILE, fallback executable via PI_BROWSER_EXECUTABLE
- Tests: smoke, generic, shadow, hidden, list, real-user, selectorshub, upload-and-fallback
