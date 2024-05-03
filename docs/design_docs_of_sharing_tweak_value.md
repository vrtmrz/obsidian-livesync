# Sharing `Tweak values`

NOTE: This is the planned feature design document. This is planned, but not be implemented now (v0.23.3). This has not reached the design freeze and will be added to from time to time.

## Goal

Share `Tweak values` between clients to match the chunk lengths, and match per-server configurations for better performance.

## Motivation

- In the current implementation, Self-hosted LiveSync splits documents into metadata and multiple chunks. In particular, chunks are split so that they do not exceed a certain length.
    - This is to optimise the transfer and take advantage of the properties of CouchDB. This also complies with the restriction of IBM Cloudant on the size of a single document.
- The length of this chunk is adjusted according to a configured factor. Therefore, if this is inconsistent between clients, de-duplication will not work. This is because, in fact, they point to the same content in total, but are split in different places. This results in unnecessary transfers or storage consumption.
- The same applies to hash algorithms.
- There are more configurations which `preferred to be matched`, even if it is not required. such as the maximum size of files to be handled and the interval between requests to the remote database, unless there are specific circumstances.
- To avoid the tragedy of "Too many toggles", "Unexpected transfer amount", or "Poor performance" at once, the plug-in should know these problems or potential problems and be able to let us know.

## Prerequisite
- We must be informed of a discrepancy in a configured value that is required to be absolutely consistent and be able to make a decision on the spot.
- We should be able to see on the configuration dialogue, that there is a discrepancy between configured values that should be matched, and it should be possible to adjust them to a specific one of them (or default).
- We must not be exposed to unexpected; such as leaking credentials or their secrets.

## Outlined methods and implementation plans
### Abstract
- In the current implementation, each client checks the remote database for the existence of their node information, to detect whether the remote database accepts them.
  - This is what 'Lock' is all about.
- To achieve this feature, the client will also send each configuration value. However, the configuration contains credentials and/or secret values. Hence we cannot send all of them.
  - With a favourable prediction, Self-hosted LiveSync will continue to increase in feature. Each time this happens, the number of configuration values to be kept secret will also increase. Therefore, they must be handled by an allow-list.
  - This allow-listed configuration are the `Tweak values`.
- If the plug-in detects mismatched `Tweak values` on checking the remote database, the plug-in will ask us to decide which is win (Mine, or theirs).
- Node information is one of the documents. Therefore, it will be replicated and saved locally. While showing dialogue, show the notice on each `Match preferred` configuration.

## Note
This feature should be mostly harmless. We will not be able to disable this.

## Test strategy

A: During synchronisation.
1. No message shall be displayed with all settings matched.
2. Message shall be displayed when there are mismatched, required match items. 
   1. The setting values can be changed according to the message.
   2. The message can be ignored.
3. The message shall not be displayed even if there are mismatched items which is recommended to be matched.

B: On the setting dialogue.
1. All mismatched items shall be highlighted in some way.

## Documentation strategy

- This document is published, and will be referred from the release note.
- Indeed, we lack a fulfilled configuration table. Efforts will be made and, if they can be produced, this document will then be referenced. But not required while in the experimental or beta feature.
    - However, this might be an essential feature. Further efforts are desired.

### Consideration and Conclusion
To be described after implemented, tested, and, released.