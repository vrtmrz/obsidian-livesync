### 0.18.0

#### Now, paths of files in the database can now be obfuscated. (Experimental Feature)
At before v0.18.0, Self-hosted LiveSync used the path of files, to detect and resolve conflicts. In naive. The ID of the document stored in the CouchDB was naturally the filename.
However, it means a sort of lacking confidentiality. If the credentials of the database have been leaked, the attacker (or an innocent bystander) can read the path of files. So we could not use confidential things in the filename in some environments.
Since v0.18.0, they can be obfuscated. so it is no longer possible to decipher the path from the ID. Instead of that, it costs a bit CPU load than before, and the data structure has been changed a bit.

We can configure the `Path Obfuscation` in the `Remote database configuration` pane.  
Note: **When changing this configuration, we need to rebuild both of the local and the remote databases**.

#### Minors 
- 0.18.1
  - Fixed:
    - Some messages are fixed (Typo)
    - File type detection now works fine!
- 0.18.2
  - Improved:
    - The setting pane has been refined.
    - We can enable `hidden files sync` with several initial behaviours; `Merge`, `Fetch` remote, and `Overwrite` remote.
    - No longer `Touch hidden files`.
- 0.18.3
  - Fixed Pop-up is now correctly shown after hidden file synchronisation.
- 0.18.4
  - Fixed:
      - `Fetch` and `Rebuild database` will work more safely.
      - Case-sensitive renaming now works fine.
        Revoked the logic which was made at #130, however, looks fine now.
- 0.18.5
  - Improved:
    - Actions for maintaining databases moved to the `🎛️Maintain databases`.
    - Clean-up of unreferenced chunks has been implemented on an **experimental**.
      - This feature requires enabling `Use new adapter`.
      - Be sure to fully all devices synchronised before perform it.
      - After cleaning up the remote, all devices will be locked out. If we are sure had it be synchronised, we can perform only cleaning-up locally. If not, we have to perform `Fetch`.

- 0.18.6
  - New features:
    - Now remote database cleaning-up will be detected automatically.
    - A solution selection dialogue will be shown if synchronisation is rejected after cleaning or rebuilding the remote database.
    - During fetching or rebuilding, we can configure `Hidden file synchronisation` on the spot.
      - It let us free from conflict resolution on initial synchronising.

... To continue on to `updates_old.md`.
