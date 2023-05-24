---
name: Issue report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---

Thank you for taking the time to report this issue!
To improve the process, I would like to ask you to let me know the information in advance.

All instructions and examples, and empty entries can be deleted.
Just for your information, a [filled example](https://docs.vrtmrz.net/LiveSync/hintandtrivia/Issue+example) is also written.

## Abstract
The synchronisation hung up immediately after connecting.

## Expected behaviour
- Synchronisation ends with the message `Replication completed`
- Everything synchronised

## Actually happened
- Synchronisation has been cancelled with the message `TypeError ... ` (captured in the attached log, around LL.10-LL.12)
- No files synchronised

## Reproducing procedure

1. Configure LiveSync as in the attached material.
2. Click the replication button on the ribbon.
3. Synchronising has begun.
4. About two or three seconds later, we got the error `TypeError ... `.
5. Replication has been stopped. No files synchronised.

Note: If you do not catch the reproducing procedure, please let me know the frequency and signs.

## Report materials
If the information is not available, do not hesitate to report it as it is. You can also of course omit it if you think this is indeed unnecessary. If it is necessary, I will ask you.

### Report from the LiveSync
For more information, please refer to [Making the report](https://docs.vrtmrz.net/LiveSync/hintandtrivia/Making+the+report).
<details>
<summary>Report from hatch</summary>

```
<!-- paste here -->
```
</details>

### Obsidian debug info
<details>
<summary>Debug info</summary>

```
<!-- paste here -->
```
</details>

### Plug-in log
We can see the log by tapping the Document box icon. If you noticed something suspicious, please let me know.
Note: **Please enable `Verbose Log`**. For detail, refer to [Logging](https://docs.vrtmrz.net/LiveSync/hintandtrivia/Logging), please.

<details>
<summary>Plug-in log</summary>

```
<!-- paste here -->
```
</details>

### Network log
Network logs displayed in DevTools will possibly help with connection-related issues. To capture that, please refer to [DevTools](https://docs.vrtmrz.net/LiveSync/hintandtrivia/DevTools).

### Screenshots
If applicable, please add screenshots to help explain your problem.

### Other information, insights and intuition.
Please provide any additional context or information about the problem.
