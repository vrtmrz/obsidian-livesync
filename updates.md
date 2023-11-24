### 0.21.0
The E2EE encryption V2 format has been reverted. That was probably the cause of the glitch.
Instead, to maintain efficiency, files are treated with Blob until just before saving. Along with this, the old-fashioned encryption format has also been discontinued.
There are both forward and backwards compatibilities, with recent versions. However, unfortunately, we lost compatibility with filesystem-livesync or some.
It will be addressed soon. Please be patient if you are using filesystem-livesync with E2EE.


#### Version history
- 0.21.0
  - Changes and performance improvements:
    - Now the saving files are processed by Blob.
    - The V2-Format has been reverted.
    - New encoding format has been enabled in default.
    - WARNING: Since this version, the compatibilities with older Filesystem LiveSync have been lost.

... To continue on to `updates_old.md`.