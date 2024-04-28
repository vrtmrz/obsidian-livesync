## The design document of the journal sync

Original title: Synchronise without CouchDB 

### Goal
- Synchronise vaults without CouchDB 

### Motivation 
- Serving CouchDB is not pretty easy. 
- Full spec DBaaS (Paid IBM Cloudant) is a bit expensive and lacking of alternatives. 
- Securing alternatives, from just one protocol.

### Prerequisite
- We should have multiple implementations of the server software. 
- We should also be able to use SaaS, with a choice of options.
	- We should require them a reasonable sense of cost, ideally free of charge for trials. 
- We should be able to serve some instance of the server software, as OSS — with transparency, availability of auditing, and the fact that they actually took place.

### Methods and implementations

Ordinarily, local pouchDB and the remote CouchDB are synchronised by sending each missing document through several conversations in their replication protocol. However, to achieve this plan, we cannot rely on CouchDB and its protocols. This limitation is so harsh. However, Overcoming this means gaining new possibilities. After some trials, It was concluded that synchronisation could be completed even if the actions that could be performed were limited to uploading, downloading and retrieving the list. This means we can use any old-fashioned WebDAV server, and Sophisticated “Object storages” such as Self-hosted MinIO, S3, and R2 or any we like. This is realised by sharing and complementing the differences of the journal by each client. Therefore, The focus is therefore on how to identify which are the differences and send them without dynamic communication.

All clients manage their data in PouchDB. I know this is probably known information, but it has its own journal. 

First, all clients should record to what point in the journal they sent themselves last time. The client then packs from the previous point to the latest when sending and also updates their record. This pack is uploaded to the server with the name starting with the timestamp of its creation. This is the send operation. 

Conversely, when receiving, the packs uploaded to the server that have not yet been received are received in order. This is easy as their names are in date order. When the process is successfully completed, the names of the files received are recorded. The journals from this pack are then reflected in their own database. Conflict resolution is left to PouchDB, so the client only needs to do the work of applying any differences. And here is the key: the client records the ID and revision of the document that was in the journal and applied.

This key works when creating a pack. When creating a pack, the client omits this 'document recorded as received and used'. This is because received and applied means that it has already been sent by another client and exists on the server. This ensures that unnecessary transmissions do not take place.

Synchronisation is then always started by receiving. This is a little trick to avoid including unnecessary documents in the pack.

These behaviours allow clients to voluntarily send and receive only the missing parts of the journal that are not stored on the server, without having to communicate with each other, and still keep a single, consistent journal on the server.

Source codes actually implemented this is already committed into the repository. 

### Test strategy

This implementation replaces the synchronisation performed by CouchDB. Therefore, testing was simply done by comparing the same changes to the same vault, replicated in CouchDB, with those done by this implementation.

### Documentation strategy

- Documentation should be done in a quick setup, at least.
- As several server implementations can be selected, the description is omitted with regard to specific configuration values.
- A MinIO set-up might be nice to have. However, it is not considered essential.
- It would be a good opportunity to also publish these design documents.

### Consideration and Conclusion

This design offers a novel approach to journal synchronisation without relying on CouchDB. It leverages PouchDB's journaling capabilities and leverages simple server-side storage for efficient data exchange. Hence, the new design could be said to have gotten a broader outlook.