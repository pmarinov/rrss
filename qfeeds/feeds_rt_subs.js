// feeds_rt_subs.js, -*- mode: javascript; -*-
//
// This software is distributed under the terms of the BSD License.
// Copyright (c) 2021, Peter Marinov and Contributors
// see LICENSE.txt, CONTRIBUTORS.txt

//
// Handle events for a remote table of RSS subscriptions
//

// Declare empty namespace if not yet defined
if (typeof feeds_rt_subs_ns === 'undefined')
  feeds_rt_subs_ns = {};

(function ()
{
"use strict";

// object rtHandlerSubs [constructor]
// Instantiate one per application
function rtHandlerSubs(feeds, rtName)
{
  let self = this;

  self.m_feeds = feeds;
  self.m_rtName = rtName;

  // Help strict mode detect miss-typed fields
  Object.preventExtensions(this);

  return this;
}

// object RemoteFeedUrl [constructor]
// From an RssHeader constructs a RemoteFeedUrl record
function RemoteFeedUrl(feed)
{
  if (feed == null)  // An empty object was requested?
    return [null, null, null]

  // url, tags, user-set options for the feed
  return [feed.m_url, feed.m_tags, ""];
}

// object rtHandlerSubs.fullTableWrite
// (Full Write) Walk over all RSS subscription records in the local DB and send all of then
// to remote table
//
// Params:
// rt -- Remote Tables Object
function fullTableWrite(rt, cbDone)
{
  let self = this;
  let all = [];

  self.m_feeds.p_feedsUpdateAll(
      function(feed)
      {
        // Parameter: 'feed' one subsription descriptor -- one by one
        // this function is called for all entries in the table
        // indexed db 'rss_subscription'

        if (feed == null)  // No more entries
        {
          // Write to remote table all the entries that were collected
          // in local variable all[]
          rt.writeFullState(self.m_rtName, all, function(exitCode)
              {
                // Chain into cbDone()
                if (cbDone != null)
                  cbDone(exitCode);
              });
          return 0;
        }

        // One row in the remote table
        let newRemoteEntry = new RemoteFeedUrl(feed);
        // Collect it
        all.push(newRemoteEntry);

        // No changes to the entry, move to the next
        return 2;
      });
}
rtHandlerSubs.prototype.fullTableWrite = fullTableWrite;

// object rtHandlerSubs.handleEntryEvent
// Handle updates from the remote tables for 'rss_subscriptions'
// (Entries added/set or deleted)
function handleEntryEvent(records, cbDone)
{
  let self = this;

  let numCompleted = 0;
  let requestCompleted = false;
  let k = 0;
  let r = null;
  for (k = 0; k < records.length; ++k)
  {
    (function()  // scope
    {
      // Unfold one record -- each simply an array of 2 entries
      r = records[k];
      let feedUrl = r.data[0];

      let sha1 = CryptoJS.SHA1(feedUrl);
      let feedHash = sha1.toString();
      let x = self.m_feeds.p_feedFindByHash(feedHash);

      // Skip operation if it is remote delete
      // Local delete will take place when scheduled
      if (r.isDeleted)  // remotely deleted?
      {
        if (x == -1)
        {
          log.warn('rtHandlerSubs.handleEntryEvent: unknown feed ' + feedHash);
          return;
        }
        log.info('rtHandlerSubs.handleEntryEvent: deleted remotely -- ' + self.m_feeds.m_rssFeeds[x].m_url);

        // TODO: We need to have p_feedRemove have a call-back cbDone
        self.m_feeds.p_feedRemove(self.m_feeds.m_rssFeeds[x].m_url, false);
        self.m_feeds.m_feedsCB.onRemoteFeedDeleted(feedHash);
        return;  // leave the anonymous scope
      }

      let feedTags = r.data[1];

      // A record was added or updated
      let newFeed = null;
      if (x == -1)   // Update or addition of a new feed from a remote operation
      {
        newFeed = feeds_ns.emptyRssHeader();
      }
      else
      {
        // We already have such feed locally: this is an update operation
        newFeed = feeds_ns.copyRssHeader(self.m_feeds.m_rssFeeds[x]);
      }
      // Now apply the data that come from the remote operation
      newFeed.m_hash = feedHash;
      newFeed.m_url = feedUrl;
      newFeed.m_tags = feedTags;
      newFeed.m_remote_state = feeds_ns.RssSyncState.IS_SYNCED;

      // Put into local list of RSS subscriptions (self.m_feeds.m_rssFeeds)
      self.m_feeds.p_feedInsert(newFeed);

      ++numCompleted;  // The number of expected completion callbacks

      // Put in the IndexedDB
      self.m_feeds.p_feedRecord(newFeed, false,
          function(wasUpdated)
          {
            --numCompleted;

            // Everything already recorded?
            if (requestCompleted && numCompleted == 0)
            {
              log.info(`rtHandlerSubs.handleEntryEvent: marked ${numEntries} as IS_SYNCED`);
              cbDone();
            }

            if (wasUpdated == 1)
            {
              // New feed -> fetch RSS data
              self.m_feeds.p_fetchRss(newFeed.m_url, null,
                  function()  // CB: write operation is completed
                  {
                    // If any extra activation/display is needed
                    self.m_feeds.m_feedsCB.onRemoteFeedUpdated(newFeed.m_url, newFeed.m_tags);
                  });
            }
            else
              log.info('rtHandlerSubs.handleEntryEvent: nothing to do for ' + newFeed.m_url);
          });
    })()
  }
  requestCompleted = true;

  // Check if the for() loop above ended up scheduling anything
  if (numCompleted == 0)
  {
    // No changes in the IndexedDB
    log.info(`rtHandlerSubs.handleEntryEvent: Nothing done for ENTRY_UPDATED or all was synchronous`);
    cbDone();
  }
}
rtHandlerSubs.prototype.handleEntryEvent = handleEntryEvent;

// object rtHandlerSubs.fullTableSync
// (Full Sync) Apply a full remote state locally
//
// Params:
// cbSynclocaltable -- Function of rtable, invoke to complete sync of
//                     remote table by supplying the local keys
// cbDone -- Chain in the completion callback
function fullTableSync(cbSyncLocalTable, cbDone)
{
  let self = this;

  // Make a hash map of the local entries, mark them entries as 0
  let k = 0;
  let entry = null;
  let localEntries = {};
  let synced = false;
  for (k = 0; k < self.m_feeds.m_rssFeeds.length; ++k)
  {
    entry = self.m_feeds.m_rssFeeds[k];

    synced = false
    if (entry.m_remote_state == feeds_ns.RssSyncState.IS_SYNCED)
      synced = true;

    localEntries[entry.m_url] = {is_synced: synced, reserved: 0};
  }

  cbSyncLocalTable(self.m_rtName, localEntries, cbDone);
}
rtHandlerSubs.prototype.fullTableSync = fullTableSync;

// object rtHandlerSubs.markAsSynced
// Set remote status of all RSS subscriptions as IS_SYNCED in the
// local Indexed DB

// Params:
// listRemoteSubs -- an array in the format sent for remote table operations,
//     see RemoteFeedUrl() for the formation of the entry
// cbDone -- Invoke at the end to notify operation in the DB as completed
function markAsSynced(listRemoteSubs, cbDone)
{
  let self = this;

  let feedIndex = 0;
  let numCompleted = 0;
  let requestCompleted = false;
  let numEntries = listRemoteSubs.length;
  for (feedIndex = 0; feedIndex < listRemoteSubs.length; ++feedIndex)
  {
    let entry = listRemoteSubs[feedIndex];
    let cnt = feedIndex;  // A copy in the current scope

    // Search for feed f
    let f = feeds_ns.emptyRssHeader();
    f.m_url = entry[0];  // Element 0 is the URL (remote table entry format)

    // find if a feed with this URL is already in m_rssFeeds[]
    let index = self.m_feeds.m_rssFeeds.binarySearch(f, feeds_ns.compareRssHeadersByUrl);
    if (index < 0)
    {
      log.warn('rtHandlerSubs.markAsSynced: error, ' + f.m_url + ' is unknown');
      continue;
    };
    let target = self.m_feeds.m_rssFeeds[index];

    if (target.m_remote_state == feeds_ns.RssSyncState.IS_SYNCED)
    {
      log.info(`rtHandlerSubs.markAsSynced: entry [${cnt}] (${target.m_url}): ALREADY marked, skipping it`);
      continue;
    }

    target.m_remote_state = feeds_ns.RssSyncState.IS_SYNCED;  // Ends up in m_rssFeeds[] too

    ++numCompleted;  // The number of expected completion callbacks
    self.m_feeds.p_feedRecord(target, false, function ()
        {
          --numCompleted;

          // Everything already marked?
          if (requestCompleted && numCompleted == 0)
          {
            log.info(`rtHandlerSubs.markAsSynced: marked ${numEntries} as IS_SYNCED`);
            cbDone();
          }
        });
  }
  requestCompleted = true;

  // Check if the for() loop above ended up scheduling anything
  if (numCompleted == 0)
  {
    // No changes in the IndexedDB
    log.info(`rtHandlerSubs.markAsSynced: Nothing needed to be marked as IS_SYNCED`);
    cbDone();
  }
}
rtHandlerSubs.prototype.markAsSynced = markAsSynced;

// export to feeds_rt_subs_ns namespace
feeds_rt_subs_ns.rtHandlerSubs = rtHandlerSubs;
})();
