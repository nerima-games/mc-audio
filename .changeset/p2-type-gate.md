---
'@nerima-games/mc-audio': minor
---

Require `@nerima-games/mc-kernel` 0.8.0. Consumers must align their kernel dependency to 0.8.0 before upgrading
mc-audio. The audio package has no runtime API migration for the kernel's 0.8.0 changes, but its compile fixture
keeps the kernel-owned time and block-id brands at the public boundary. Consumers should run their typecheck with
the package manager's resolved kernel dependency, pass external audio JSON through the parsers as `unknown`, inspect
`TonePlayback.accepted`, and call `WebAudioBackend.unlock` from a user gesture.
