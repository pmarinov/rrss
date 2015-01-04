// feeds_import.js, -*- mode: javascript; -*-
//
// This software is distributed under the terms of the BSD License.
// Copyright (c) 2014, Peter Marinov and Contributors
// see LICENSE.txt, CONTRIBUTORS.txt

//
// Management of UI for importing and exporting feeds and folders in OPML format
//

// Declare empty namespace if not yet defined
if (typeof feeds_ns === 'undefined')
  feeds_ns = {};

(function ()
{
"use strict";

// object FeedsImport.FeedsImport [constructor]
// Instantiate one per application
function FeedsImport(feedsDB)
{
  var self = this;

  var listContainer1 = utils_ns.domFind('#xopml_list');

  self.m_feedsDB = feedsDB;
  self.m_opmlFeeds = null;  // Array of FeedEntry, after parsing of OPML xml

  self.$d =
  {
    opmlStep1: utils_ns.domFind('#ximport_opml_step1_input_file'),
    opmlStep2: utils_ns.domFind('#ximport_opml_step2_display_file'),
    opmlTitle: utils_ns.domFind('#opml_title'),
    opmlTotal: utils_ns.domFind('#opml_total'),
    opmlError1: utils_ns.domFind('#xopml_error1'),
    entryImportOpml: utils_ns.domFind('#ximport_opml'),
    inputOpmlFile: utils_ns.domFind('#ximport_input_opml_file'),
    inputOpmlFileArea: utils_ns.domFind('#ximport_input_opml_file_area'),
    sectionDisplayOpml: utils_ns.domFind('#ximport_opml_step2_display_file'),
    listContainer: listContainer1,
    list: utils_ns.domFindInside(listContainer1, '.xopml_entry', -1),
    btnAll1: utils_ns.domFind('#xopml_all1', -1),
    btnAll2: utils_ns.domFind('#xopml_all2', -1),
    btnNone1: utils_ns.domFind('#xopml_none1', -1),
    btnNone2: utils_ns.domFind('#xopml_none2', -1)
  };

  self.$d.inputOpmlFile.on('change', function()
      {
        var f = this.files[0]
        self.handleOPMLFile(f);
      });

  self.$d.btnAll1.on('click', function ()
      {
        self.selectAllEntries();
      });

  self.$d.btnAll2.on('click', function ()
      {
        self.selectAllEntries();
      });

  self.$d.btnNone1.on('click', function ()
      {
        self.deselectAllEntries();
      });

  self.$d.btnNone2.on('click', function ()
      {
        self.deselectAllEntries();
      });

  return this;
}

// Object FeedEntry.clearInputField
function clearInputField()
{
  var self = this;

  self.$d.inputOpmlFile.val('');  // Clear the file name
  self.$d.opmlError1.toggleClass('hide', true); // Hide the error msg area
}
FeedsImport.prototype.clearInputField = clearInputField;

// Object FeedEntry.showError1
// Show error for step 1
function showError1(msg)
{
  var self = this;

  self.$d.opmlError1.text(msg); // Hide the error msg area
  self.$d.opmlError1.toggleClass('hide', false); // Show the error msg area
}
FeedsImport.prototype.showError1 = showError1;

// Object FeedEntry.FeedEntry [constructor]
function FeedEntry(folder, feedUrl, feedSiteUrl, feedTitle)
{
  // If it is a folder name entry, it is only the folder and nothing else
  this.m_folder = folder;
  this.m_isFolder = true;
  this.m_feedUrl = null;
  this.m_feedSiteUrl = null;
  this.m_feedTitle = null;
  if (feedUrl != null)
  {
    // Not a folder, an RSS feed
    this.m_isFolder = false;
    this.m_feedUrl = feedUrl;
    this.m_feedSiteUrl = feedSiteUrl;
    this.m_feedTitle = feedTitle;
  }

  this.m_alreadySubscribed = false;
  this.m_selected = true;

  // Help strict mode detect misstyped fields
  Object.preventExtensions(this);

  return this;
}

// object FeedsImport.printFeedEntry
// print FeedEntry in the log
function printFeedEntry(entry)
{
  utils_ns.assert(entry instanceof FeedEntry, 'opml: printFeedEntry: x instanceof FeedEntry');
  if (entry.m_isFolder)
    log.info('FOLDER: ' + entry.m_folder);
  else
    log.info('RSS: ' + entry.m_feedUrl + ' into ' + entry.m_folder);
}
FeedsImport.prototype.printFeedEntry = printFeedEntry;

// object FeedsImport.compareOPML
// Helpef function:
// comparator for sorting of opmlArray so that folders are in alphabetical order
// and inside the folders the feeds are sorted alphabetically by title
function compareOPML(e1, e2)
{
  if (e1.m_folder == e2.m_folder)
  {
    // NOTE: e1.m_folder and/or e2.m_folder might be null
    if (e1.m_isFolder)   // Folder name should be at the top of the group
      return -1;
    else if (e2.m_isFolder)
      return 1;
    else if (e1.m_feedTitle == e2.m_feedTitle)
      return 0;
    else if (e1.m_feedTitle < e2.m_feedTitle)
      return -1;
    else
      return 1; // e1.m_feedTitle > e2.m_feedTitle
  }
  else if (e1.m_folder == null)  // Entries with no folder should go to the end
    return -1;
  else if (e2.m_folder == null)
    return 1;
  else if (e1.m_folder < e2.m_folder)
    return -1;
  else
    return 1;
}
FeedsImport.prototype.compareOPML = compareOPML;

// object FeedsImport.parseOPML
// Parse OPML XML
// Returns an array of RSS entries and folders
function parseOPML($opml, cbSetTitle)
{
  var self = this;

  var i = 0;
  var j = 0;
  var opmlArray = [];
  var opmlEntry = null;
  var numEntries = jQuery($opml).children().length;
  var numFolderEntries = 0;
  var titleStr = null;
  var $topEntry = null;
  var $entry = null;
  var tagNameStr = null;
  var feedUrlStr = null;
  var feedSiteUrlStr = null;
  var typeStr = null;
  var folderNameStr = null;
  for (i = 0; i < numEntries; ++i)
  {
    $topEntry = jQuery($opml).children().eq(i);
    tagNameStr = $topEntry.prop('tagName');
    if (tagNameStr == 'TITLE')
    {
      titleStr = $topEntry.text();
      cbSetTitle(titleStr);
    }
    else if (tagNameStr = 'OUTLINE')
    {
      titleStr = $topEntry.attr('title');
      feedUrlStr = $topEntry.attr('xmlurl');
      feedSiteUrlStr = $topEntry.attr('htmlurl');
      // Is it folder or an rss entry, check attr 'type'
      typeStr = $topEntry.attr('type');
      if (typeStr == 'rss')
      {
        // RSS feed at top level, this is outside any folders
        opmlEntry = new FeedEntry(null, feedUrlStr, feedSiteUrlStr, titleStr);
        opmlArray.push(opmlEntry);
      }
      else
      {
        // Folder
        opmlEntry = new FeedEntry(titleStr, null, null, null);
        opmlArray.push(opmlEntry);

        // Process all entries inside the folder
        numFolderEntries = $topEntry.children().length;
        folderNameStr = titleStr;
        for (j = 0; j < numFolderEntries; ++j)
        {
          $entry = jQuery($topEntry).children().eq(j);

          titleStr = $entry.attr('title');
          feedUrlStr = $entry.attr('xmlurl');
          feedSiteUrlStr = $entry.attr('htmlurl');
          typeStr = $entry.attr('type');

          if (typeStr != 'rss')
          {
            log.warning('Invalid OPML entry, not an RSS');
            continue;
          }

          opmlEntry = new FeedEntry(folderNameStr, feedUrlStr, feedSiteUrlStr, titleStr);
          opmlArray.push(opmlEntry);
        }
      }
    }
    else
    {
      log.warning('parseOPML: unknown tag ' + tagNameStr);
    }
  }

  opmlArray.sort(self.compareOPML);

  for (i = 0; i < opmlArray.length; ++i)
    self.printFeedEntry(opmlArray[i]);

  return opmlArray;
}
FeedsImport.prototype.parseOPML = parseOPML;

// object FeedsImport.selectAllEntries
// Handle action of button "All" -- select all entries
function selectAllEntries()
{
  var self = this;

  var i = 0;
  var x = null;
  var $e = null;
  var $rssEntry = null;
  var $checkbox = null;
  for (i = 0; i < self.m_opmlFeeds.length; ++i)
  {
    x = self.m_opmlFeeds[i];
    utils_ns.assert(x instanceof FeedEntry, 'opml: selectAllEntries: x instanceof FeedEntry');

    if (x.m_isFolder)
      continue;

    if (x.m_alreadySubscribed)  // Disabled and checkbox is permanently OFF
      continue;

    $e = jQuery(self.$d.list[i]);

    x.m_selected = true;

    $rssEntry = utils_ns.domFindInside($e, '.xopml_feed_entry');
    $checkbox = utils_ns.domFindInside($rssEntry, '.xopml_checkbox');
    $checkbox.prop('checked', true);
  }
}
FeedsImport.prototype.selectAllEntries = selectAllEntries;

// object FeedsImport.deselectAllEntries
// Handle action of button "None" -- deselect all entries
function deselectAllEntries()
{
  var self = this;

  var i = 0;
  var x = null;
  var $e = null;
  var $rssEntry = null;
  var $checkbox = null;
  for (i = 0; i < self.m_opmlFeeds.length; ++i)
  {
    x = self.m_opmlFeeds[i];
    utils_ns.assert(x instanceof FeedEntry, 'opml: deselectAllEntries: x instanceof FeedEntry');

    if (x.m_isFolder)
      continue;

    if (x.m_alreadySubscribed)  // Disabled and checkbox is permanently OFF
      continue;

    $e = jQuery(self.$d.list[i]);

    x.m_selected = false;

    $rssEntry = utils_ns.domFindInside($e, '.xopml_feed_entry');
    $checkbox = utils_ns.domFindInside($rssEntry, '.xopml_checkbox');
    $checkbox.prop('checked', false);
  }
}
FeedsImport.prototype.deselectAllEntries = deselectAllEntries;

// object FeedsImport.displayOPML
//
// It is called only once after parsing. All other actions manipulate
// individual DOM elements.
function displayOPML()
{
  var self = this;

  var i = 0;

  // Can the domList accomodate all entries in opmlFeeds?
  if (self.m_opmlFeeds.length > self.$d.list.length)
  {
    var maxNew = self.m_opmlFeeds.length - self.$d.list.length;
    for (i = 0; i < maxNew; ++i)
      self.$d.listContainer.append($(self.$d.list[0]).clone());
  }
  // Reacquire the expanded list
  self.$d.list = utils_ns.domFindInside(self.$d.listContainer, '.xopml_entry', -1);

  //
  // Display the entries imported from the OPML list
  var x = null;
  var idx = 0;
  var $e = null;
  var $folder = null;
  var $rssEntry = null;
  var $title = null;
  var $rssUrl = null;
  var $siteUrl = null;
  var $checkbox = null;
  var $labelSubscribed = null;
  for (i = 0; i < self.m_opmlFeeds.length; ++i)
  {
    x = self.m_opmlFeeds[i];
    utils_ns.assert(x instanceof FeedEntry, 'opml: displayOPML: x instanceof FeedEntry');
    $e = jQuery(self.$d.list[i]);

    $e.toggleClass('hide', false);  // Make sure entry is not hidden

    $folder = utils_ns.domFindInside($e, '.xopml_folder');
    $rssEntry = utils_ns.domFindInside($e, '.xopml_feed_entry');
    if (x.m_isFolder)
    {
      $title = utils_ns.domFindInside($folder, '.xopml_folder_name');
      $title.text(x.m_folder);

      $rssEntry.toggleClass('hide', true);
      $folder.toggleClass('hide', false);
    }
    else
    {
      $title = utils_ns.domFindInside($rssEntry, '.xopml_title_source');
      $rssUrl = utils_ns.domFindInside($rssEntry, '.xopml_url');
      $siteUrl = utils_ns.domFindInside($rssEntry, '.xopml_site_url');
      $checkbox = utils_ns.domFindInside($rssEntry, '.xopml_checkbox');
      $labelSubscribed = utils_ns.domFindInside($rssEntry, '.xopml_subscribed');

      $title.text(x.m_feedTitle);
      $rssUrl.text(x.m_feedUrl);
      $siteUrl.attr('href', x.m_feedSiteUrl);

      $folder.toggleClass('hide', true);
      $rssEntry.toggleClass('hide', false);

      // Setup the check box depending on if the feed is already subscribed
      idx = self.m_feedsDB.feedListSearch(x.m_feedUrl);
      if (idx >= 0)
      {
        // This entry is already subscribed
        $checkbox.prop('checked', false);
        $checkbox.prop('disabled', true);
        $labelSubscribed.toggleClass('hide', false); // Show '[subscribed]'
        x.m_selected = false;
        x.m_alreadySubscribed = true;
      }
      else
      {
        $checkbox.prop('checked', true);
        $checkbox.prop('disabled', false);
        $labelSubscribed.toggleClass('hide', true); // Show '[subscribed]'
      }
    }
  }

  // Collapse all unused entries in self.$d.list
  for (; i < self.$d.list.length; ++i)
  {
    $e = jQuery(self.$d.list[i]);
    $e.toggleClass('hide', true);
  }
}
FeedsImport.prototype.displayOPML = displayOPML;

// object FeedsImport.handleOPMLFile
// Handles new OPML file input from user
function handleOPMLFile(file)
{
  var self = this;

  self.$d.opmlTitle.text('No title');

  var reader = new FileReader();
  reader.onload = function(evt)
      {
        if (evt.target.readyState == FileReader.DONE)  // DONE == 2
        {
          var xmlStr = evt.target.result;
          // TODO: check for max safe file size
          //alert(f.name + ' ' + f.size + ' bytes => ' + s.substr(0, 24));
          var $parsed = jQuery(xmlStr);
          if ($parsed.length == 0)
            alert('not a valid XML');

          var i = 0;
          var $opml = null;
          for(i = 0; i < $parsed.length; ++i)
          {
            if($parsed[i].nodeName == 'OPML')
            {
              $opml = $parsed[i];
              break;
            }
          }
          if ($opml == null)
            alert('opml not found');
          if (jQuery($opml).prop('tagName') != 'OPML')
            alert('opml not found');
          var version = jQuery($opml).attr('version');
          if (version != '1.0')
            alert('unsupported version of opml: ' + version);

          self.m_opmlFeeds = self.parseOPML($opml, function(opmlTitle)
              {
                // Display title of OPML feed (immediate action from
                // parsing, no need to store it anywhere)
                self.$d.opmlTitle.text(opmlTitle);
              });

          // Activate area for step2 -- preview and selection of feeds
          // from the OPML file
          self.$d.opmlStep1.toggleClass('hide', true);
          self.$d.opmlStep2.toggleClass('hide', false);

          // Display the entries
          self.$d.opmlTotal.text(self.m_opmlFeeds.length + ' entries');
          self.displayOPML();
        }
      };

  var s = reader.readAsText(file);
}
FeedsImport.prototype.handleOPMLFile = handleOPMLFile;

// object PanelImportOpml.onFocusLost
function onFocusLostImportOpml()
{
  var self = this;

  self.$d.entryImportOpml.toggleClass('selected', false);
}
FeedsImport.prototype.onFocusLost = onFocusLostImportOpml;

// object PanelImportOpml.onFocus
function onFocusImportOpml()
{
  var self = this;

  self.$d.entryImportOpml.toggleClass('selected', true);

  // Activate pane for step 1 (Select an OPML file)
  self.clearInputField();  // Clear in case there is anything from previous input

  // Check for the various File API support.
  if (!(window.File && window.FileReader && window.FileList && window.Blob))
  {
    self.showError1('Generic: The File APIs are not fully supported in this browser.');
    self.$d.inputOpmlFileArea.toggleClass('hide', true);  // Hide the input
  }

  self.$d.opmlStep1.toggleClass('hide', false);
  self.$d.opmlStep2.toggleClass('hide', true);
}
FeedsImport.prototype.onFocus = onFocusImportOpml;

// export to feeds_ns namespace
feeds_ns.FeedsImport = FeedsImport;
})();
