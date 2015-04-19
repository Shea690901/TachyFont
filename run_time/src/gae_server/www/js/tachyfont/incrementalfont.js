'use strict';

/**
 * @license
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

goog.provide('tachyfont.IncrementalFont');
goog.provide('tachyfont.TachyFont');

goog.require('goog.Promise');
goog.require('goog.log');
goog.require('goog.log.Level');
goog.require('goog.math');
goog.require('tachyfont.CharCmapInfo');
goog.require('tachyfont.DemoBackendService');
goog.require('tachyfont.FontInfo');
goog.require('tachyfont.GoogleBackendService');
goog.require('tachyfont.IncrementalFontUtils');
goog.require('tachyfont.RLEDecoder');
goog.require('tachyfont.promise');


/**
 * tachyfont.IncrementalFont - A sub-namespace.
 */
tachyfont.IncrementalFont = function() {
};


/**
 * The IndexedDB version.
 * Increment this number every time there is a change in the schema.
 *
 * @type {number}
 */
tachyfont.IncrementalFont.version = 1;


/**
 * The maximum time in milliseconds to hide the text to prevent FOUT.
 *
 * @type {number}
 */
tachyfont.IncrementalFont.MAX_HIDDEN_MILLISECONDS = 3000;


/**
 * The database name.
 *
 * @type {string}
 */
tachyfont.IncrementalFont.DB_NAME = 'incrfonts';


/**
 * The time in milliseconds to wait before persisting the data.
 *
 * @type {number}
 */
tachyfont.IncrementalFont.PERSIST_TIMEOUT = 1000;


/**
 * The base name.
 *
 * @type {string}
 */
tachyfont.IncrementalFont.BASE = 'base';


/**
 * The base is dirty (needs to be persisted) key.
 *
 * @type {string}
 */
tachyfont.IncrementalFont.BASE_DIRTY = 'base_dirty';


/**
 * The char list name.
 *
 * @type {string}
 */
tachyfont.IncrementalFont.CHARLIST = 'charlist';


/**
 * The charlist is dirty (needs to be persisted) key.
 *
 * @type {string}
 */
tachyfont.IncrementalFont.CHARLIST_DIRTY = 'charlist_dirty';


/**
 * Get the incremental font object.
 * This class does the following:
 * 1. Create a class using the "@font-face" rule and with visibility=hidden
 * 2. Create an incremental font manager object.
 * 3. Open the IndexedDB.
 * 4. Start the operation to get the base.
 * 5. Start the operation to get the list of fetched/not-fetched chars.
 * 6. Create a "@font-face" rule (need the data to make the blob URL).
 * 7. When the base is available set the class visibility=visible
 *
 * @param {!tachyfont.FontInfo} fontInfo Info about this font.
 * @param {Object} params Optional parameters.
 * @return {tachyfont.IncrementalFont.obj_} The incremental font manager object.
 */
tachyfont.IncrementalFont.createManager = function(fontInfo, params) {
  var fontName = fontInfo.getName();
  var backendService =
      fontInfo.getFontKit() ?
      new tachyfont.GoogleBackendService(fontInfo.getUrl()) :
      new tachyfont.DemoBackendService(fontInfo.getUrl());

  var initialVisibility = false;
  var initialVisibilityStr = 'hidden';
  if (params['visibility'] == 'visible') {
    initialVisibility = true;
    initialVisibilityStr = 'visible';
  }
  var maxVisibilityTimeout = tachyfont.IncrementalFont.MAX_HIDDEN_MILLISECONDS;
  if (params['maxVisibilityTimeout']) {
    try {
      maxVisibilityTimeout = parseInt(params['maxVisibilityTimeout'], 10);
    } catch (err) {
    }
  }

  // Create a style for this font.
  var style = document.createElement('style');
  document.head.appendChild(style);
  var rule = '.' + fontName + ' { font-family: ' + fontName + '; ' +
      'visibility: ' + initialVisibilityStr + '; }';
  style.sheet.insertRule(rule, 0);

  //tachyfont.timer1.start('load base');
  tachyfont.timer1.start('load Tachyfont base+data for ' + fontName);
  // if (goog.DEBUG) {
  //   goog.log.info(tachyfont.logger,
  //     'check to see if a webfont is in cache');
  // }
  var incrFontMgr =
      new tachyfont.IncrementalFont.obj_(fontInfo, params, backendService);
  //tachyfont.timer1.start('openIndexedDB.open ' + fontName);
  //  tachyfont.IncrementalFontUtils.logger(incrFontMgr.url,
  //    'need to report info');
  /*
  if (goog.DEBUG) {
    goog.log.info(tachyfont.logger, 'It would be good to report status of:\n' +
        '* idb\n' +
        '* chars needed\n' +
        '* webfont in cache\n' +
        '* timing\n' +
        '* way to collect the info\n' +
        '* way to clear old info\n' +
        '* errors');
  }
  */
  incrFontMgr.getIDB_ = incrFontMgr.openIndexedDB(fontName);
  //tachyfont.timer1.end('openIndexedDB.open ' + fontName);

  // Create a class with initial visibility.
  incrFontMgr.style = tachyfont.IncrementalFontUtils.setVisibility(null,
      fontInfo, initialVisibility);
  // Limit the maximum visibility=hidden time.
  setTimeout(function() {
    tachyfont.IncrementalFontUtils.setVisibility(incrFontMgr.style, fontInfo,
        true);
  }, maxVisibilityTimeout);

  // Start the operation to get the list of already fetched chars.
  if (goog.DEBUG) {
    goog.log.log(tachyfont.logger, goog.log.Level.FINER,
        'Get the list of already fetched chars.');
  }
  incrFontMgr.getCharList = incrFontMgr.getIDB_.
      then(function(idb) {
        if (tachyfont.persistData) {
          return incrFontMgr.getData_(idb, tachyfont.IncrementalFont.CHARLIST);
        } else {
          var e = new Event('not using persisting charlist');
          return goog.Promise.reject(e);
        }
      }).
      thenCatch(function(e) {
        return {};
      }).
      then(function(charlist_data) {
        return charlist_data;
      }).thenCatch(function(e) {
        if (goog.DEBUG) {
          goog.log.error(tachyfont.logger, e.stack);
          debugger;
        }
      });

  if (tachyfont.buildDemo) {
    tachyfont.buildDemo = false;
    // For Debug: add a button to clear the IndexedDB.
    tachyfont.ForDebug.addDropIdbButton(incrFontMgr, fontName);

    // For Debug: add a control to set the bandwidth.
    tachyfont.ForDebug.addBandwidthControl();

    // For Debug: add a control to set the timing text size.
    tachyfont.ForDebug.addTimingTextSizeControl();
  }

  return incrFontMgr;
};



/**
 * IncrFontIDB.obj_ - A class to handle interacting the IndexedDB.
 * @param {!tachyfont.FontInfo} fontInfo Info about this font.
 * @param {Object} params Optional parameters.
 * @param {!tachyfont.BackendService} backendService object used to generate
 *     backend requests.
 * @constructor
 * @private
 */
tachyfont.IncrementalFont.obj_ = function(fontInfo, params, backendService) {
  /**
   * Information about the fonts
   *
   * @type {!tachyfont.FontInfo}
   */
  this.fontInfo = fontInfo;

  this.fontName = fontInfo.getName();
  
  this.fileInfo_;
  
  /**
   * Indicates if the cmap may be easily kept accurate.
   * @type {boolean}
   */
  this.hasOneCharPerSeg = false;

  /** 
   * The character to format 4 / format 12 mapping.
   * 
   * @private {Object.<string, !tachyfont.CharCmapInfo>}
   */
  this.cmapMapping_;

  this.charsToLoad = {};
  //TODO(bstell): need to fix the request size.
  this.req_size = params['req_size'] || 2200;

  /**
   * True if new characters have been loaded since last setFont
   *
   * @type {boolean}
   */
  this.needToSetFont = false;

  this.url = fontInfo.getUrl();
  this.charsURL = '/incremental_fonts/request';
  this.alreadyPersisted = false;
  this.persistData = true;
  this.persistInfo = {};
  this.persistInfo[tachyfont.IncrementalFont.BASE_DIRTY] = false;
  this.persistInfo[tachyfont.IncrementalFont.CHARLIST_DIRTY] = false;
  this.style = null;

  /** @type {!tachyfont.BackendService} */
  this.backendService = backendService;

  if (params['persistData'] == false || !tachyfont.persistData) {
    this.persistData = false;
  }

  if (!this.url) {
    this.url = window.location.protocol + '//' + window.location.hostname +
        (window.location.port ? ':' + window.location.port : '');
  }

  // Promises
  this.getIDB_ = null;
  this.base = new tachyfont.promise();
  this.getBase = this.base.getPromise();
  this.getCharList = null;

  // TODO(bstell): Use ChainedPromise to properly serialize the promises.
  this.finishPersistingData = goog.Promise.resolve();

  /**
   * The character request operation takes time so serialize them.
   *
   * TODO(bstell): Use ChainedPromise to properly serialize the promises.
   *
   * @private {goog.Promise}
   */
  this.finishPrecedingCharsRequest_ = goog.Promise.resolve();

  /**
   * The setFont operation takes time so serialize them.
   *
   * TODO(bstell): Use ChainedPromise to properly serialize the promises.
   *
   * @private {goog.Promise}
   */
  this.finishPrecedingSetFont_ = goog.Promise.resolve();
};


/**
 * Get the font base from persistent store.
 * @return {goog.Promise} The base bytes in DataView.
 */
tachyfont.IncrementalFont.obj_.prototype.getPersistedBase = function() {
  var persistedBase = this.getIDB_.
      then(function(idb) {
        var filedata;
        if (tachyfont.persistData) {
          filedata = this.getData_(idb, tachyfont.IncrementalFont.BASE);
        } else {
          if (goog.DEBUG) {
            goog.log.fine(tachyfont.logger,
                'not using persisting data: ' + this.fontName);
          }
          filedata = goog.Promise.resolve(null);
        }
        return goog.Promise.all([goog.Promise.resolve(idb), filedata]);
      }.bind(this)).
      then(function(arr) {
        var idb = arr[0];
        var filedata = new DataView(arr[1]);
        var fileInfo = tachyfont.IncrementalFontUtils.parseBaseHeader(filedata);
        this.fileInfo_ = fileInfo;
        var fontData = new DataView(arr[1], fileInfo.headSize);
        return goog.Promise.all([goog.Promise.resolve(fileInfo),
              goog.Promise.resolve(fontData)]);
      }).
      thenCatch(function(e) {
        if (goog.DEBUG) {
          goog.log.log(tachyfont.logger, goog.log.Level.FINER,
              'font not persisted: ' + this.fontName);
        }
        return goog.Promise.resolve(null);
      }.bind(this));
  return persistedBase;
};


/**
 * Get the font base from a URL.
 * @param {Object} backendService The object that interacts with the backend.
 * @param {!tachyfont.FontInfo} fontInfo Info about this font.
 * @return {goog.Promise} The base bytes in DataView.
 */
tachyfont.IncrementalFont.obj_.prototype.getUrlBase =
    function(backendService, fontInfo) {
  var rslt = backendService.requestFontBase(fontInfo).
      then(function(fetchedBytes) {
        var results = this.processUrlBase_(fetchedBytes);
        this.persistDelayed_(tachyfont.IncrementalFont.BASE);
        return results;
      }.bind(this));
  return rslt;
};


/**
 * Process the font base fetched from a URL.
 * @param {ArrayBuffer} fetchedBytes The fetched data.
 * @return {Array.<Object>} The fileInfo (information about the font bytes) and
 *     the font data ready for character data to be added.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.processUrlBase_ =
    function(fetchedBytes) {
  //tachyfont.timer1.start('uncompact base');
  var fetchedData = new DataView(fetchedBytes);
  var fileInfo = tachyfont.IncrementalFontUtils.parseBaseHeader(fetchedData);
  this.fileInfo_ = fileInfo;
  var headerData = new DataView(fetchedBytes, 0, fileInfo.headSize);
  var rleFontData = new DataView(fetchedBytes, fileInfo.headSize);
  var raw_base = tachyfont.RLEDecoder.rleDecode([headerData, rleFontData]);
  var raw_basefont = new DataView(raw_base.buffer, headerData.byteLength);
  this.writeCmap12(raw_basefont, fileInfo);
  this.writeCmap4(raw_basefont, fileInfo);
  tachyfont.IncrementalFontUtils.writeCharsetFormat2(raw_basefont, fileInfo);
  var basefont = tachyfont.IncrementalFontUtils.sanitizeBaseFont(fileInfo,
      raw_basefont);
  //tachyfont.timer1.end('uncompact base');
  return [fileInfo, basefont];
};


/**
 * Parses base font header, set properties.
 * @param {DataView} baseFont Base font with header.
 * @param {Object} headerInfo Header information
 */
tachyfont.IncrementalFont.obj_.prototype.writeCmap12 = function(baseFont, headerInfo) {
  if (!headerInfo.cmap12)
    return;
  var binEd = new tachyfont.BinaryFontEditor(baseFont,
      headerInfo.cmap12.offset + 16);
  var nGroups = headerInfo.cmap12.nGroups;
  var segments = headerInfo.compact_gos.cmap12.segments;
  for (var i = 0; i < nGroups; i++) {
    binEd.setUint32(segments[i][0]);
    binEd.setUint32(segments[i][0] + segments[i][1] - 1);
    if (this.hasOneCharPerSeg) {
      binEd.setUint32(0);
    } else {
      binEd.setUint32(segments[i][2]);
    }
  }
};


/**
 * Inject glyphs in the glyphData to the baseFont
 * @param {Object} headerInfo The font header information.
 * @param {DataView} baseFont Current base font
 * @param {tachyfont.GlyphBundleResponse} bundleResponse New glyph data
 * @param {Object.<string, !tachyfont.CharCmapInfo>} cmapMapping the code point
 *     to cmap info mapping.
 * @param {Object.<number, !number>} glyphToCodeMap  The glyph Id to code point
 *     mapping;
 * @return {DataView} Updated base font
 */
tachyfont.IncrementalFont.obj_.prototype.injectCharacters = function(headerInfo, baseFont,
    bundleResponse, cmapMapping, glyphToCodeMap) {
  // time_start('inject')
  headerInfo.dirty = true;
  var bundleBinEd = bundleResponse.getFontEditor();
  var baseBinEd = new tachyfont.BinaryFontEditor(baseFont, 0);

  var count = bundleResponse.getGlyphCount();
  var flags = bundleResponse.getFlags();

  var isCFF = flags & tachyfont.IncrementalFontUtils.FLAGS.HAS_CFF;
  var offsetDivisor = 1;
  if (!isCFF && headerInfo.offsetSize == 2) {
    // For the loca "short version":
    //   "The actual local offset divided by 2 is stored."
    offsetDivisor = 2;
  }
  var glyphIds = [];
  for (var i = 0; i < count; i += 1) {
    var id = bundleBinEd.getUint16();
    glyphIds.push(id);
    var nextId = id + 1;
    var hmtx, vmtx;
    if (flags & tachyfont.IncrementalFontUtils.FLAGS.HAS_HMTX) {
      hmtx = bundleBinEd.getUint16();
      baseBinEd.setMtxSideBearing(headerInfo.hmtxOffset, headerInfo.hmetricCount,
          id, hmtx);
    }
    if (flags & tachyfont.IncrementalFontUtils.FLAGS.HAS_VMTX) {
      vmtx = bundleBinEd.getUint16();
      baseBinEd.setMtxSideBearing(headerInfo.vmtxOffset, headerInfo.vmetricCount,
          id, vmtx);
    }
    var offset = bundleBinEd.getUint32();
    var length = bundleBinEd.getUint16();

    if (!isCFF) {
      // Set the loca for this glyph.
      baseBinEd.setGlyphDataOffset(headerInfo.glyphDataOffset, headerInfo.offsetSize,
          id, offset / offsetDivisor);
      var oldNextOne = baseBinEd.getGlyphDataOffset(headerInfo.glyphDataOffset,
          headerInfo.offsetSize, nextId);
      var newNextOne = offset + length;
      // Set the length of the current glyph (at the loca of nextId).
      baseBinEd.setGlyphDataOffset(headerInfo.glyphDataOffset, headerInfo.offsetSize,
          nextId, newNextOne / offsetDivisor);

      // Fix the sparse loca values before this new value.
      var prev_id = id - 1;
      while (prev_id >= 0 && baseBinEd.getGlyphDataOffset(headerInfo.glyphDataOffset,
          headerInfo.offsetSize, prev_id) > offset) {
        baseBinEd.setGlyphDataOffset(headerInfo.glyphDataOffset, headerInfo.offsetSize,
            prev_id, offset / offsetDivisor);
        prev_id--;
      }
      /*
       * Fix up the sparse loca values after this glyph.
       *
       * If value is changed and length is nonzero we should make the next glyph
       * a dummy glyph(ie: write -1 to make it a composite glyph).
       */
      var isChanged = oldNextOne != newNextOne;
      isChanged = isChanged && nextId < headerInfo.numGlyphs;
      if (isChanged) {
        // Fix the loca value after this one.
        baseBinEd.seek(headerInfo.glyphOffset + newNextOne);
        if (length > 0) {
          baseBinEd.setInt16(-1);
        }else if (length == 0) {
          /*if it is still zero,then could write -1*/
          var currentUint1 = baseBinEd.getUint32(),
              currentUint2 = baseBinEd.getUint32();
          if (currentUint1 == 0 && currentUint2 == 0) {
            baseBinEd.seek(headerInfo.glyphOffset + newNextOne);
            baseBinEd.setInt16(-1);
          }
        }
      }
    } else {
      baseBinEd.setGlyphDataOffset(headerInfo.glyphDataOffset, headerInfo.offsetSize,
          id, offset);
      var oldNextOne = baseBinEd.getGlyphDataOffset(headerInfo.glyphDataOffset,
          headerInfo.offsetSize, nextId);
      baseBinEd.setGlyphDataOffset(headerInfo.glyphDataOffset, headerInfo.offsetSize, nextId,
          offset + length);
      nextId = id + 2;
      var offsetCount = headerInfo.numGlyphs + 1;
      var currentIdOffset = offset + length, nextIdOffset;
      if (oldNextOne < currentIdOffset && nextId - 1 < offsetCount - 1) {
        baseBinEd.seek(headerInfo.glyphOffset + currentIdOffset);
        baseBinEd.setUint8(14);
      }
      while (nextId < offsetCount) {
        nextIdOffset = baseBinEd.getGlyphDataOffset(headerInfo.glyphDataOffset,
            headerInfo.offsetSize, nextId);
        if (nextIdOffset <= currentIdOffset) {
          currentIdOffset++;
          baseBinEd.setGlyphDataOffset(headerInfo.glyphDataOffset, headerInfo.offsetSize,
              nextId, currentIdOffset);
          if (nextId < offsetCount - 1) {
            baseBinEd.seek(headerInfo.glyphOffset + currentIdOffset);
            baseBinEd.setUint8(14);
          }
          nextId++;
        } else {
          break;
        }
      }
    }

    var bytes = bundleBinEd.getArrayOf(bundleBinEd.getUint8, length);
    baseBinEd.seek(headerInfo.glyphOffset + offset);
    baseBinEd.setArrayOf(baseBinEd.setUint8, bytes);
  }
  // Set the glyph Ids in the cmap format 12 subtable;
  this.setFormat12GlyphIds_(headerInfo, baseFont, 
    glyphIds, glyphToCodeMap, cmapMapping);

  // Set the glyph Ids in the cmap format 4 subtable;
  this.setFormat4GlyphIds_(headerInfo, baseFont, 
    glyphIds, glyphToCodeMap, cmapMapping);

  // time_end('inject')

  return baseFont;
};


/**
 * Set the format 4 glyph Ids.
 * 
 * Note: this is not well tested.
 * 
 * @param {Object} headerInfo The object with the font header information.
 * @param {DataView} baseFont Current base font
 * @param {Array.<number>} glyphIds The glyph Ids to set.
 * @param {Object.<number, Array.<!number>>} glyphToCodeMap The glyph Id to code
 *     point mapping;
 * @param {Object.<string, !tachyfont.CharCmapInfo>} cmapMapping the code point
 *     to cmap info mapping.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.setFormat4GlyphIds_ =
  function(headerInfo, baseFont, glyphIds, glyphToCodeMap, cmapMapping) {
  if (!headerInfo.cmap4) {
    return;
  }
  var segments = headerInfo.compact_gos.cmap4.segments;
  var binEd = new tachyfont.BinaryFontEditor(baseFont,
      headerInfo.cmap4.offset + 6);
  var segCount = binEd.getUint16() / 2;
  if (segCount != segments.length) {
    if (goog.DEBUG) {
      goog.log.error(tachyfont.logger, 'segCount=' + segCount +
        ', segments.length=' + segments.length);
      debugger;
    }
    return;
  }
  binEd.seek(8);
  for (var i = 0; i < segCount; i++) {
    // Check the end code.
    var segEndCode = binEd.getUint16();
    if (segEndCode != segments[i][1]) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'segment ' + i + ': segEndCode (' +
          segEndCode + ') != segments[' + i + '][1] (' + segments[i][1] + ')');
        debugger;
      }
      return;
    }
    // Check the segment is one char long
    if (segEndCode != segments[i][0]) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'segment ' + i + ' is ' +
          (segments[i][1] - segments[i][0] + 1) + ' chars long');
        debugger;
      }
      return;
    }
  }
  binEd.skip(2);//skip reservePad
  for (var i = 0; i < segCount; i++) {
    var segStartCode = binEd.getUint16();
    if (segStartCode != segments[i][0]) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'segment ' + i + ': segStartCode (' +
          segStartCode + ') != segments[' + i + '][1] (' + segments[i][0] +
          ')');
        debugger;
      }
      return;
    }
  }
  var idDeltaOffset = binEd.tell();
  for (var i = 0; i < segCount; i++) {
    var segIdDelta = binEd.getUint16();
    var segGlyphId = (segIdDelta + segments[i][0]) & 0xFFFF;
    if (segGlyphId != 0) {
      if (goog.DEBUG) {
        if (segIdDelta == segments[i][2]) {
          goog.log.info(tachyfont.logger, 'segment ' + i + 
            ': segIdDelta already set');
        } else {
          goog.log.error(tachyfont.logger, 'segment ' + i + ': segIdDelta (' +
            segIdDelta + ') != segments[' + i + '][1] (' + segments[i][2] +
            ')');
          debugger;
          return;
        }
      }
    }
  }
  for (var i = 0; i < segCount; i++) {
    var segIdRangeOffset = binEd.getUint16();
    if (segIdRangeOffset != 0) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'segment ' + i +
          ': segIdRangeOffset (' + segIdRangeOffset + ') != 0');
        debugger;
      }
      return;
    }
  }
  for (var i = 0; i < glyphIds.length; i++) {
    // Set the glyph Id
    var glyphId = glyphIds[i];
    var code = glyphToCodeMap[glyphId];
    if (goog.DEBUG) {
      goog.log.info(tachyfont.logger, 'format 4: code = ' + code);
    }
    var charCmapInfo = cmapMapping[code];
    if (!charCmapInfo) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'format 4, code ' + code +
          ': no CharCmapInfo');
        debugger;
      }
      continue;
    }
    var format4Seg = charCmapInfo.format4Seg;
    if (format4Seg == null) {
      if (goog.DEBUG) {
        if (code <= 0xFFFF) {
          goog.log.error(tachyfont.logger,
            'format 4, missine segment for code ' + code);
          debugger;
        }
      }
      // Character is not in the format 4 segment.
      continue;
    }
    binEd.seek(idDeltaOffset + format4Seg * 2);
    binEd.setUint16(segments[format4Seg][2]);
  }

};


/**
 * Set the format 12 glyph Ids.
 * 
 * @param {Object} headerInfo The object with the font header information.
 * @param {DataView} baseFont Current base font
 * @param {Array.<number>} glyphIds The glyph Ids to set.
 * @param {Object.<number, Array.<!number>>} glyphToCodeMap The glyph Id to code
 *     point mapping;
 * @param {Object.<string, !tachyfont.CharCmapInfo>} cmapMapping the code point
 *     to cmap info mapping.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.setFormat12GlyphIds_ =
  function(headerInfo, baseFont, glyphIds, glyphToCodeMap, cmapMapping) {
  if (!headerInfo.cmap12) {
    return;
  }
  var segEd = new tachyfont.BinaryFontEditor(baseFont,
    headerInfo.cmap12.offset + 16);
  var segments = headerInfo.compact_gos.cmap12.segments;
  for (var i = 0; i < glyphIds.length; i += 1) {
    var id = glyphIds[i];
    var code = glyphToCodeMap[id];
    if (goog.DEBUG) {
      goog.log.info(tachyfont.logger, 'format 12: code = ' + code);
    }
    var charCmapInfo = cmapMapping[code];
    if (!charCmapInfo) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'format 12, code ' + code +
          ': no CharCmapInfo');
        debugger;
      }
      continue;
    }

    // Set the glyphId for format 12
    var format12Seg = charCmapInfo.format12Seg;
    var segment = segments[format12Seg];
    var segStartCode = segment[0];
    var segEndCode = segStartCode + segment[1] - 1;
    var segStartGlyphId = segment[2];
    var segOffset = format12Seg * 12;
    segEd.seek(segOffset);
    var inMemoryStartCode = segEd.getUint32();
    var inMemoryEndCode = segEd.getUint32();
    var inMemoryGlyphId = segEd.getUint32();
    if (goog.DEBUG) {
      // Check the code point.
      if (inMemoryStartCode != segStartCode) {
        goog.log.error(tachyfont.logger, 'format 12, code ' + code + ', seg ' 
          + format12Seg + ': startCode mismatch');
        debugger;
      }
      if (inMemoryEndCode != segEndCode) {
        goog.log.error(tachyfont.logger, 'format 12 code ' + code + ', seg ' +
          format12Seg + ': endCode mismatch');
        debugger;
      }
      if (segStartCode != segEndCode) { // TODO(bstell): check length
        goog.log.error(tachyfont.logger, 'format 12 code ' + code + ', seg ' +
          format12Seg + ': length != 1');
        debugger;
      }
      if (inMemoryGlyphId != 0) {
        if (inMemoryGlyphId == segStartGlyphId) {
          goog.log.error(tachyfont.logger, 'format 12 code ' + code + ', seg ' +
            format12Seg + ' glyphId already set');
        } else {
          goog.log.error(tachyfont.logger, 'format 12 code ' + code + ', seg ' +
            format12Seg + ' glyphId mismatch');
          debugger;
        }
      }
    }
    // Seek to the glyphId.
    segEd.seek(segOffset + 8);
    // Set the glyphId.
    segEd.setUint32(segStartGlyphId);


  }
};


/**
 * Parses base font header, set properties.
 * @param {DataView} baseFont Base font with header.
 * @param {Object} headerInfo Header information
 */
tachyfont.IncrementalFont.obj_.prototype.writeCmap4 = function(baseFont, headerInfo) {
  if (!headerInfo.cmap4)
    return;
  var segments = headerInfo.compact_gos.cmap4.segments;
  var glyphIdArray = headerInfo.compact_gos.cmap4.glyphIdArray;
  var binEd = new tachyfont.BinaryFontEditor(baseFont,
      headerInfo.cmap4.offset + 6);
  var segCount = binEd.getUint16() / 2;
  if (segCount != segments.length) {
    if (goog.DEBUG) {
      alert('segCount=' + segCount + ', segments.length=' + segments.length);
      debugger;
    }
  }
  var glyphIdArrayLen = (headerInfo.cmap4.length - 16 - segCount * 8) / 2;
  headerInfo.cmap4.segCount = segCount;
  headerInfo.cmap4.glyphIdArrayLen = glyphIdArrayLen;
  binEd.skip(6); //skip searchRange,entrySelector,rangeShift
  // Write endCode values.
  for (var i = 0; i < segCount; i++) {
    binEd.setUint16(segments[i][1]);
  }
  binEd.skip(2);//skip reservePad
  // Write startCode values.
  for (var i = 0; i < segCount; i++) {
    binEd.setUint16(segments[i][0]);
  }
  // Write idDelta values.
  for (var i = 0; i < segCount; i++) {
    if (this.hasOneCharPerSeg) {
      // Make the single code point in this segment point to .notdef 
      var startCode = segments[i][0];
      binEd.setUint16(0x10000 - startCode);
    } else {
      // Use the normal starting glyphId
      binEd.setUint16(segments[i][2]);
    }
  }
  // Write idRangeOffset vValues.
  for (var i = 0; i < segCount; i++) {
    binEd.setUint16(segments[i][3]);
  }
  // Write glyphIdArray values.
  if (glyphIdArrayLen > 0)
    binEd.setArrayOf(binEd.setUint16, glyphIdArray);
};




/**
 * Set the \@font-face rule.
 * @param {DataView} fontData The font dataview.
 * @param {boolean} isTtf True if the font is a TrueType font.
 * @return {goog.Promise} The promise resolves when the glyphs are displaying.
 */
tachyfont.IncrementalFont.obj_.prototype.setFont = function(fontData, isTtf) {
  if (goog.DEBUG) {
    goog.log.log(tachyfont.logger, goog.log.Level.FINER,
        'setFont: wait for preceding');
  }
  return this.finishPrecedingSetFont_
      .then(function() {
        if (goog.DEBUG) {
          goog.log.log(tachyfont.logger, goog.log.Level.FINER,
             'setFont: done waiting for preceding');
        }
        this.needToSetFont = false;
        this.finishPrecedingSetFont_ = new goog.Promise(function(resolve) {
          if (goog.DEBUG) {
            goog.log.fine(tachyfont.logger, 'setFont ' +
                this.fontInfo.getName());
          }
          var mimeType, format;
          if (isTtf) {
            mimeType = 'font/ttf'; // 'application/x-font-ttf';
            format = 'truetype';
          } else {
            mimeType = 'font/otf'; // 'application/font-sfnt';
            format = 'opentype';
          }
          var blobUrl = tachyfont.IncrementalFontUtils.getBlobUrl(
             this.fontInfo, fontData, mimeType);

          return this.setFontNoFlash(this.fontInfo, format, blobUrl).
             then(function() {
               if (goog.DEBUG) {
                 goog.log.fine(tachyfont.logger, 'setFont: setFont done');
               }
               resolve();
             });
        }.bind(this));
        return this.finishPrecedingSetFont_;
      }.bind(this));
};


/**
 * Determine if the font was preprocessed to have only one character per 
 * segment. Fonts with this arrangement easily support keeping the cmap
 * accurate as character data is added.
 * 
 * @param {Object} headerInfo The font header information.
 */
tachyfont.IncrementalFont.obj_.prototype.determineIfOneCharPerSeg = 
  function(headerInfo) {
  if (headerInfo.cmap4) {
    var segments = headerInfo.compact_gos.cmap4.segments;
    for (var i = 0; i < segments.length; i++) {
      var segStartCode = segments[i][0];
      var segEndCode = segments[i][1];
      var idRangeOffset = segments[i][3];
      if (segStartCode != segEndCode || idRangeOffset != 0) {
        if (goog.DEBUG) {
          goog.log.warning(tachyfont.logger, this.fontName +
            ' format4 has more than one char per segment');
        }
        return;
      }
    }
  }

  if (headerInfo.cmap12) {
    var segments = headerInfo.compact_gos.cmap12.segments;
    for (var i = 0; i < segments.length; i++) {
      var length = segments[i][1];
      if (length != 1) {
        if (goog.DEBUG) {
          goog.log.warning(tachyfont.logger, this.fontName +
            ' format12 has more than one char per segment');
        }
        return;
      }
    }
  }

  if (goog.DEBUG) {
    goog.log.info(tachyfont.logger, this.fontName +
      ' has one char per segment');
  }

  this.hasOneCharPerSeg = true;
};


/**
 * Obfuscate small requests to make it harder for a TachyFont server to
 * determine the content on a page.
 * @param {Array<number>} codes The codepoints to add obusfuscation to.
 * @param {Object} charlist The chars that have already been requested.
 * @return {Array<number>} The codepoints with obusfuscation.
 */
tachyfont.possibly_obfuscate = function(codes, charlist) {
  // Check if we need to obfuscate the request.
  if (codes.length >= tachyfont.MINIMUM_NON_OBFUSCATION_LENGTH)
    return codes;

  var code_map = {};
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    code_map[code] = code;
  }
  var num_new_codes = tachyfont.MINIMUM_NON_OBFUSCATION_LENGTH - codes.length;
  var target_length = tachyfont.MINIMUM_NON_OBFUSCATION_LENGTH;
  var max_tries = num_new_codes * 10 + 100;
  for (var i = 0;
      Object.keys(code_map).length < target_length && i < max_tries;
      i++) {
    var code = codes[i % codes.length];
    var bottom = code - tachyfont.OBFUSCATION_RANGE / 2;
    if (bottom < 0) {
      bottom = 0;
    }
    var top = code + tachyfont.OBFUSCATION_RANGE / 2;
    var new_code = Math.floor(goog.math.uniformRandom(bottom, top + 1));
    if (charlist[new_code] == undefined) {
      code_map[new_code] = new_code;
      var new_char = String.fromCharCode(new_code);
      charlist[new_char] = 1;
    }
    if (goog.DEBUG) {
      goog.log.log(tachyfont.logger, goog.log.Level.FINER,
          Object.keys(code_map).length.toString());
    }
  }

  if (goog.DEBUG) {
    goog.log.log(tachyfont.logger, goog.log.Level.FINER,
        'before obfuscation: codes.length = ' + codes.length);
    codes.sort(function(a, b) { return a - b; });
    goog.log.fine(tachyfont.logger, 'codes = ' + codes);
  }
  var combined_codes = [];
  var keys = Object.keys(code_map);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    combined_codes.push(code_map[key]);
  }
  if (goog.DEBUG) {
    goog.log.log(tachyfont.logger, goog.log.Level.FINER,
        'after obfuscation: combined_codes.length = ' + combined_codes.length);
    combined_codes.sort(function(a, b) { return a - b; });
    goog.log.fine(tachyfont.logger, 'combined_codes = ' +
        combined_codes);
  }
  return combined_codes;
};


/**
 * Load the data for needed chars.
 *
 * TODO(bstell): fix the return value.
 * @return {goog.Promise} Returns the true if characters loaded.
 */
tachyfont.IncrementalFont.obj_.prototype.loadChars = function() {
  if (goog.DEBUG) {
    goog.log.fine(tachyfont.logger, 'loadChars');
  }
  var that = this;
  var chars = '';
  var charlist;
  var neededCodes = [];
  var remaining = [];
  // TODO(bstell): this method of serializing the requests seems like it could
  // allow multiple requests to wait on a single promise. When that promise
  // resolved all the waiting requests would be unblocked.
  //
  // This probably needs to be replaced with a queue of requests that works as
  // follows:
  //
  //   An initial resolved promise is added to the front of the queue. As a new
  //   request comes it addes itself to the end of the queue and waits on the
  //   previous request to resolve.
  this.finishPrecedingCharsRequest_ = this.finishPrecedingCharsRequest_.
      then(function() {
        // TODO(bstell): use charCmapInfo to only request chars in the font.
        var charArray = Object.keys(that.charsToLoad);
        // Check if there are any new characters.
        // TODO(bstell): until the serializing is fixed this stops multiple
        // requests running on the same resolved promise.
        if (charArray.length == 0) {
          return null;
        }
        var pendingResolveFn, pendingRejectFn;
        // TODO(bstell): use tachfont.promise here?
        return new goog.Promise(function(resolve, reject) {
          pendingResolveFn = resolve;
          pendingRejectFn = reject;

          return that.getCharList.
              then(function(charlist_) {
                charlist = charlist_;
                // Make a tmp copy in case we are chunking the requests.
                var tmp_charlist = {};
                for (var key in charlist) {
                  tmp_charlist[key] = charlist[key];
                }
                for (var i = 0; i < charArray.length; i++) {
                  var c = charArray[i];
                  if (!tmp_charlist[c]) {
                    // TODO(bstell): use cmapMapping_ to determine if the font
                    // supports that code. If not, then skip it.
                    neededCodes.push(tachyfont.charToCode(c));
                    tmp_charlist[c] = 1;
                  }
                }

                if (neededCodes.length) {
                  neededCodes = tachyfont.possibly_obfuscate(neededCodes,
                  tmp_charlist);
                  if (goog.DEBUG) {
                    goog.log.info(tachyfont.logger, that.fontInfo.getName() +
                    ': load ' + neededCodes.length + ' codes:');
                    goog.log.log(tachyfont.logger, goog.log.Level.FINER,
                    '' + neededCodes);
                  }
                } else {
                  if (goog.DEBUG) {
                    goog.log.fine(tachyfont.logger, 'no new characters');
                  }
                  pendingResolveFn(false);
                  return;
                }
                neededCodes.sort(function(a, b) { return a - b; });
                if (that.req_size) {
                  remaining = neededCodes.slice(that.req_size);
                  neededCodes = neededCodes.slice(0, that.req_size);
                }
                for (var i = 0; i < neededCodes.length; i++) {
                  var c = String.fromCharCode(neededCodes[i]);
                  charlist[c] = 1;
                  delete that.charsToLoad[c];
                }
                return that.backendService.requestCodepoints(that.fontInfo,
                neededCodes).
                then(function(bundleResponse) {
                  if (remaining.length) {
                    setTimeout(function() {
                      that.loadChars();
                    }, 1);
                  }
                  // if (goog.DEBUG) {
                  //   goog.log.info(tachyfont.logger,
                  //     'requested char data length = ' +chardata.byteLength);
                  // }
                  return bundleResponse;
                });
              }).
              then(function(bundleResponse) {
                return that.getBase.
                then(function(arr) {
                  var fileInfo = arr[0];
                  var fontData = arr[1];
                  var dataLength = 0;
                  if (bundleResponse != null) {
                    dataLength = bundleResponse.getDataLength();
                    if (dataLength != 0) {
                      that.needToSetFont = true;
                    }
                    if (goog.DEBUG) {
                      goog.log.info(tachyfont.logger,
                      that.fontName +
                      ' injectCharacters: glyph count / data length = ' +
                      bundleResponse.getGlyphCount() + ' / ' + dataLength);
                    }
                    //debugger;
                    var glyphToCodeMap = {};
                    for (var i = 0; i < neededCodes.length; i++) {
                      var code = neededCodes[i];
                      var charCmapInfo = that.cmapMapping_[code];
                      if (charCmapInfo) {
                        // TODO(bstell): need to handle multipe codes sharing a glyphId
                        glyphToCodeMap[charCmapInfo.glyphId] = code;
                      }
                    }
                    // TODO(bstell): injectCharacters should be a object function (not static)
                    fontData = that.injectCharacters(
                      fileInfo, fontData, bundleResponse, that.cmapMapping_,
                      glyphToCodeMap);
                    var msg;
                    if (remaining.length) {
                      msg = 'display ' + Object.keys(charlist).length +
                          ' chars';
                    } else {
                      msg = '';
                      tachyfont.timer1.end('load Tachyfont base+data for ' +
                      that.fontName);
                      tachyfont.timer1.done();
                    }
                    // Update the data promises.
                    that.getBase = goog.Promise.all(
                        [goog.Promise.resolve(fileInfo),
                      goog.Promise.resolve(fontData)]);
                    that.getCharList = goog.Promise.resolve(charlist);

                    // Persist the data.
                    that.persistDelayed_(tachyfont.IncrementalFont.BASE);
                    that.persistDelayed_(tachyfont.IncrementalFont.CHARLIST);
                  } else {
                    var msg = '';
                    tachyfont.timer1.end('load Tachyfont base+data for ' +
                    that.fontName);
                    tachyfont.timer1.done();
                  }
                  pendingResolveFn(true);
                }).
                thenCatch(function(e) {
                  if (goog.DEBUG) {
                    debugger;
                    goog.log.error(tachyfont.logger, 'failed to getBase: ' +
                    e.stack);
                  }
                  pendingRejectFn(false);
                });
              });
        }).
            thenCatch(function(e) {
              if (goog.DEBUG) {
                debugger;
                goog.log.error(tachyfont.logger, 'loadChars: ' + e.stack);
              }
              pendingRejectFn(false);
            });
      }).
      then(function() {
        if (goog.DEBUG) {
          goog.log.log(tachyfont.logger, goog.log.Level.FINER,
              'finished loadChars for ' + that.fontName);
        }
      }).
      thenCatch(function(e) {
        if (goog.DEBUG) {
          debugger;
          goog.log.error(tachyfont.logger, e.stack);
          return goog.Promise.resolve(false);
        }
      });
  return this.finishPrecedingCharsRequest_;
};


/**
 * Save data that needs to be persisted.
 *
 * @param {string} name The name of the data item.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.persistDelayed_ = function(name) {
  if (!this.persistData) {
    return;
  }
  var that = this;
  // if (goog.DEBUG) {
  //   goog.log.fine(tachyfont.logger, 'persistDelayed ' + name);
  // }

  // Note what needs to be persisted.
  if (name == tachyfont.IncrementalFont.BASE) {
    this.persistInfo[tachyfont.IncrementalFont.BASE_DIRTY] = true;
  } else if (name == tachyfont.IncrementalFont.CHARLIST) {
    this.persistInfo[tachyfont.IncrementalFont.CHARLIST_DIRTY] = true;
  }

  // In a little bit do the persisting.
  setTimeout(function() {
    that.persist_(name);
  }, tachyfont.IncrementalFont.PERSIST_TIMEOUT);
};


/**
 * Save data that needs to be persisted.
 * @param {string} name The name of the data item.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.persist_ = function(name) {
  var that = this;
  // Wait for any preceding persist operation to finish.
  this.finishPersistingData.then(function() {
    // Previous persists may have already saved the data so see if there is
    // anything still to persist.
    var base_dirty = that.persistInfo[tachyfont.IncrementalFont.BASE_DIRTY];
    var charlist_dirty =
        that.persistInfo[tachyfont.IncrementalFont.CHARLIST_DIRTY];
    if (!base_dirty && !charlist_dirty) {
      return;
    }

    // What ever got in upto this point will get saved.
    that.persistInfo[tachyfont.IncrementalFont.BASE_DIRTY] = false;
    that.persistInfo[tachyfont.IncrementalFont.CHARLIST_DIRTY] = false;

    // Note that there is now a persist operation running.
    that.finishPersistingData = goog.Promise.resolve().
        then(function() {
          if (base_dirty) {
            return that.getBase.
            then(function(arr) {
              return goog.Promise.all([that.getIDB_,
                goog.Promise.resolve(arr[0]), goog.Promise.resolve(arr[1])]);
            }).
            then(function(arr) {
              if (goog.DEBUG) {
                goog.log.fine(tachyfont.logger, 'save base');
              }
              return that.saveData_(arr[0],
              tachyfont.IncrementalFont.BASE, arr[2].buffer);
            });
          }
        }).
        then(function() {
          if (charlist_dirty) {
            return that.getCharList.
            then(function(charlist) {
              return goog.Promise.all([that.getIDB_,
                goog.Promise.resolve(charlist)]);
            }).
            then(function(arr) {
              if (goog.DEBUG) {
                goog.log.fine(tachyfont.logger, 'save charlist');
              }
              return that.saveData_(arr[0], tachyfont.IncrementalFont.CHARLIST,
              arr[1]);
            });
          }
        }).
        thenCatch(function(e) {
          if (goog.DEBUG) {
            goog.log.error(tachyfont.logger, 'persistDelayed_: ' + e.stack);
            debugger;
          }
        }).
        then(function() {
          // if (goog.DEBUG) {
          //   goog.log.fine(tachyfont.logger, 'persisted ' + name);
          // }
        });
  }).thenCatch(function(e) {
    if (goog.DEBUG) {
      goog.log.error(tachyfont.logger, e.stack);
      debugger;
    }
  });
};


/**
 * Save a data item.
 * @param {Object} idb The IndexedDB object.
 * @param {string} name The name of the item.
 * @param {Array} data The data.
 * @return {goog.Promise} Operation completion.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.saveData_ = function(idb, name, data) {
  var that = this;
  return that.getIDB_.
      then(function(db) {
        // the initialization form x = { varname: value } handles the key is a
        // literal string. If a variable varname is used for the key then the
        // string varname will be used ... NOT the value of the varname.
        return new goog.Promise(function(resolve, reject) {
          var trans = db.transaction([name], 'readwrite');
          var store = trans.objectStore(name);
          var request = store.put(data, 0);
          request.onsuccess = function(e) {
            resolve();
          };
          request.onerror = function(e) {
            if (goog.DEBUG) {
              debugger;
            }
            reject(null);
          };
        }).
           thenCatch(function(e) {
             if (goog.DEBUG) {
               goog.log.error(tachyfont.logger, 'saveData ' + db.name + ' ' +
                   name + ': ' + e.stack);
               debugger;
             }
           });
      }).thenCatch(function(e) {
        if (goog.DEBUG) {
          goog.log.error(tachyfont.logger, e.stack);
          debugger;
        }
      });
};


/**
 * Get the fontDB.
 * @param {string} fontName The name of the font.
 * @return {goog.Promise} The font DB.
 */
tachyfont.IncrementalFont.obj_.prototype.openIndexedDB = function(fontName) {
  var that = this;

  var openIDB = new goog.Promise(function(resolve, reject) {
    var db_name = tachyfont.IncrementalFont.DB_NAME + '/' + fontName;
    //tachyfont.timer1.start('indexedDB.open ' + db_name);
    var dbOpen = window.indexedDB.open(db_name,
        tachyfont.IncrementalFont.version);
    //tachyfont.timer1.end('indexedDB.open ' + db_name);

    dbOpen.onsuccess = function(e) {
      var db = e.target.result;
      resolve(db);
    };
    dbOpen.onerror = function(e) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, '!!! IncrFontIDB.obj_ "' + db_name +
            '": ' + e.value);
        debugger;
      }
      reject(e);
    };

    // Will get called when the version changes.
    dbOpen.onupgradeneeded = function(e) {
      var db = e.target.result;
      e.target.transaction.onerror = function(e) {
        if (goog.DEBUG) {
          goog.log.error(tachyfont.logger, 'onupgradeneeded error: ' +
              e.value);
          debugger;
        }
        reject(e);
      };
      if (db.objectStoreNames.contains(tachyfont.IncrementalFont.BASE)) {
        db.deleteObjectStore(tachyfont.IncrementalFont.BASE);
      }
      if (db.objectStoreNames.contains(tachyfont.IncrementalFont.CHARLIST)) {
        db.deleteObjectStore(tachyfont.IncrementalFont.CHARLIST);
      }
      db.createObjectStore(tachyfont.IncrementalFont.BASE);
      db.createObjectStore(tachyfont.IncrementalFont.CHARLIST);
    };
  });
  return openIDB;
};


/**
 * Get a part of the font.
 *
 * @param {Object} idb The IndexedDB object.
 * @param {string} name The name of the font data to get.
 * @return {goog.Promise} Promise to return the data.
 * @private
 */
tachyfont.IncrementalFont.obj_.prototype.getData_ = function(idb, name) {
  var that = this;
  var getData = new goog.Promise(function(resolve, reject) {
    var trans = idb.transaction([name], 'readwrite');
    var store = trans.objectStore(name);
    var request = store.get(0);
    request.onsuccess = function(e) {
      var result = e.target.result;
      if (result != undefined) {
        resolve(result);
      } else {
        reject(e);
      }
    };

    request.onerror = function(e) {
      if (goog.DEBUG) {
        goog.log.error(tachyfont.logger, 'e = ' + e);
        debugger;
      }
      reject(e);
    };
  }).
      thenCatch(function(e) {
        return goog.Promise.reject(e);
      });
  return getData;
};



/**
 * TachyFont - A namespace.
 * @param {!tachyfont.FontInfo} fontInfo The font info.
 * @param {Object} params Optional parameters.
 * @constructor
 */
tachyfont.TachyFont = function(fontInfo, params) {
  params = params || {};

  /**
   * The object that handles the binary manipulation of the font data.
   *
   * TODO(bstell): integrate the manager into this object.
   *
   * @type {tachyfont.IncrementalFont.obj_}
   */
  this.incrfont = tachyfont.IncrementalFont.createManager(fontInfo, params);
};


/**
 * Lazily load the data for these chars.;
 */
tachyfont.TachyFont.prototype.loadNeededChars = function() {
  this.incrfont.loadChars();
};


/**
 * Add the '@font-face' rule.
 *
 * Simply setting the \@font-face causes a Flash Of Invisible Text (FOIT). The
 * FOIT is the time it takes to:
 *   1. Pass the blobUrl data from Javascript memory to browser (C++) memory.
 *   2. Check the font with the OpenType Sanitizer (OTS).
 *   3. Rasterize the outlines into pixels.
 *
 * To avoid the FOIT this function first passes the blobUrl data to a temporary
 * \@font-face rule that is not being used to display text. Once the temporary
 * \@font-face is ready (ie: the data has been transferred, and OTS has run) any
 * existing \@font-face is deleted and the temporary \@font-face switched to be
 * the desired \@font-face.
 *
 * @param {!tachyfont.FontInfo} fontInfo Info about this font.
 * @param {string} format The \@font-face format.
 * @param {string} blobUrl The blobUrl to the font data.
 * @return {goog.Promise} The promise resolves when the glyphs are displaying.
 */
tachyfont.IncrementalFont.obj_.prototype.setFontNoFlash =
    function(fontInfo, format, blobUrl) {
  // The desired @font-face font-family.
  var fontFamily = fontInfo.getFamilyName();
  // The temporary @font-face font-family.
  var tmpFontFamily = 'tmp-' + fontFamily;
  var fontName = fontInfo.getName(); // The font name.
  var weight = fontInfo.getWeight();
  var sheet = tachyfont.IncrementalFontUtils.getStyleSheet();

  // Create a temporary @font-face rule to transfer the blobUrl data from
  // Javascript to the browser side.
  if (goog.DEBUG) {
    goog.log.log(tachyfont.logger, goog.log.Level.FINER,
        'setFont: ' + tmpFontFamily + '/' + weight);
  }
  tachyfont.IncrementalFontUtils.setCssFontRule(sheet, tmpFontFamily, weight,
      blobUrl, format);

  var setFontPromise = new goog.Promise(function(resolve, reject) {
    // Transfer the data.
    // TODO(bstell): Make this cross platform.
    var fontStr = weight + ' 20px ' + tmpFontFamily;
    if (goog.DEBUG) {
      goog.log.log(tachyfont.logger, goog.log.Level.FINER,
          'setFont: fontStr = ' + fontStr);
    }
    document.fonts.load(fontStr).
        then(function(value) {
          if (goog.DEBUG) {
            goog.log.fine(tachyfont.logger, 'loaded ' + tmpFontFamily + '/' +
                weight);
          }
          resolve();
        });
  }).
      then(function() {
        // Now that the font is ready switch the @font-face to the desired name.
        if (goog.DEBUG) {
          goog.log.log(tachyfont.logger, goog.log.Level.FINER,
              'switch to fontFamily');
        }
        // Delete the old @font-face.
        var ruleToDelete = tachyfont.IncrementalFontUtils.findFontFaceRule(
            sheet, fontFamily, weight);
        tachyfont.IncrementalFontUtils.deleteCssRule(ruleToDelete, sheet);
        // Switch the name to use the newly transfered blobUrl data.
        var rule_to_switch = tachyfont.IncrementalFontUtils.findFontFaceRule(
            sheet, tmpFontFamily, weight);
        var rules = sheet.cssRules || sheet.rules;
        if (rules && rule_to_switch != -1) {
          var this_rule = rules[rule_to_switch];
          var this_style = this_rule.style;
          if (goog.DEBUG) {
            goog.log.info(tachyfont.logger, '**** switched ' + weight +
                ' from ' + this_style.fontFamily + ' to ' + fontFamily +
                ' ****');
          }
          this_style.fontFamily = fontFamily;
        }
      });

  return setFontPromise;
};