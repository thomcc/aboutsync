// Providers for the data used by the addon.
// Data can be provided by Sync itself, or by a JSON file.
let Providers = (function() {
  'use strict';

  const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

  Cu.import("resource://gre/modules/Task.jsm");
  Cu.import("resource://services-sync/record.js");
  Cu.import("resource://gre/modules/osfile.jsm")
  Cu.import("resource://gre/modules/PlacesUtils.jsm");

  // We always clone the data we return as the consumer may modify it (and
  // that's a problem for our "export" functionality - we don't want to write
  // the modified data.
  function clone(data) {
    return Cu.cloneInto(data, {});
  }

  class Provider {
    constructor(type) {
      this.type = type;
    }
  }

  class JSONProvider extends Provider {
    constructor(url) {
      super("json");
      this._loadPromise = new Promise((resolve, reject) => {
        let request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'json';
        request.onload = () => {
          let data = request.response;
          if (data) {
            resolve(data);
          } else {
            reject("No JSON could be loaded from " + url);
          }
        }
        request.onerror = err => {
          reject("Could not load the JSON: " + err);
        }
        request.onabort = err => {
          reject("JSON load was aborted: " + err);
        }
        request.send();
      });
    }

    promiseCollectionInfo() {
      return this._loadPromise.then(data => {
        return clone(data.infos);
      });
    }

    promiseCollection(info) {
      return this._loadPromise.then(data => {
        return clone(data.collections[info.name]);
      });
    }

    promiseBookmarksTree() {
      return this._loadPromise.then(data => {
        return clone(data.bookmarksTree);
      });
    }
  }

  class LocalProvider extends Provider {
    constructor() {
      super("local");
      this._info = null;
      this._collections = {};
    }

    promiseCollectionInfo() {
      if (!this._info) {
        // Sync's nested event-loop blocking API means we should do the fetch after
        // an event spin.
        this._info = Promise.resolve().then(() => {
          let info = Weave.Service._fetchInfo();
          let result = { status: info.status, collections: [] };
          for (let name of Object.keys(info.obj).sort()) {
            // We skip these 2 collections as they aren't encrypted so must be
            // rendered differently, and aren't particularly interesting.
            if (name == "crypto" || name == "meta") {
              continue;
            }
            let lastModified = new Date(info.obj[name]);
            let url = Weave.Service.storageURL + name;
            let collectionInfo = { name, lastModified, url };
            result.collections.push(collectionInfo);
            // and kick off the fetch of the collection.
            this.promiseCollection(collectionInfo);
          }
          return result;
        });
      }
      return this._info.then(result => clone(result));
    }

    promiseCollection(info) {
      if (!this._collections[info.name]) {
        let collection = new Collection(info.url, CryptoWrapper, Weave.Service);
        collection.full = true;
        let records = [];
        let key = Weave.Service.collectionKeys.keyForCollection(info.name);
        collection.recordHandler = record => {
          record.decrypt(key)
          records.push(record.cleartext);
        }
        // Do the actual fetch after an event spin.
        this._collections[info.name] = Promise.resolve().then(() => {
          let raw = collection.get();
          // turn it into a vanilla object.
          let response = {
            url: raw.url,
            status: raw.status,
            success: raw.success,
            headers: raw.headers
          };
          return { response, records };
        });
      }
      return this._collections[info.name].then(result => clone(result));
    }

    promiseBookmarksTree() {
      return PlacesUtils.promiseBookmarksTree("", {
        includeItemIds: true
      }).then(result => clone(result));
    }

    promiseExport(path, collections = ["bookmarks"]) {
      return Task.spawn(function* () {
        // We need to wait for all collections to complete.
        let infos = yield this.promiseCollectionInfo();
        let original = infos.collections;
        infos.collections = [];
        for (let ob of original) {
          if (collections.indexOf(ob.name) >= 0) {
            infos.collections.push(ob);
          }
        }
        let ob = {
          infos: infos,
          collections: {},
        };
        if (collections.indexOf("bookmarks") >= 0) {
          ob.bookmarksTree = yield this.promiseBookmarksTree();
        }
        for (let info of infos.collections) {
          let got = yield this.promiseCollection(info);
          ob.collections[info.name] = got;
        }
        let json = JSON.stringify(ob, undefined, 2); // pretty!
        return OS.File.writeAtomic(path, json, {encoding: "utf-8", tmpPath: path + ".tmp"});
      }.bind(this));
    }
  }
  return { JSONProvider, LocalProvider };
})();
