// Components and other code for managing the friendlier Sync prefs management
// offered by this addon.

const React = require("react");
const { Fetching, InternalAnchor } = require("./common");

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Log.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/osfile.jsm"); // For "OS"
Cu.import("resource://gre/modules/Downloads.jsm");

// For our "Sync Preferences" support.
// A "log level" <select> element.
class LogLevelSelectComponent extends React.Component {
  constructor(props) {
    super(props);
  }

  handleChange(event) {
    for (let pref of this.props.prefs) {
      Preferences.set(pref, event.target.value);
    }
    // The state for these prefs are external (ie, in the Fx prefs store), so
    // force an update.
    this.forceUpdate();
  }

  render() {
    // We just take the value for the first pref (if there are multiple prefs
    // for this object we are just making them all be the same value)
    let prefName = this.props.prefs[0];
    let prefValue = Preferences.get(prefName);
    let names = Object.keys(Log.Level).filter(n => typeof Log.Level[n] == "number");
    let options = names.map(n => React.createElement("option", { value: n}, n));
    return React.createElement("select",
                               { onChange: event => this.handleChange(event),
                                 value: prefValue },
                               ...options);
  }
}

class LogLevelComponent extends React.Component {
  constructor(props) {
    super(props);
  }

  render() {
    return React.createElement("div", { className: "logLevel" },
            React.createElement("span", null, this.props.label),
            React.createElement(LogLevelSelectComponent, { prefs: this.props.prefs })
    );
  }
}

// A checkbox that's (poorly) tied to a Firefox preference value.
// Ideally we'd use an observer and be better integrated with react's state
// support so these update on-the-fly if changed externally - later!
class PrefCheckbox extends React.Component {
  constructor(props) {
    super(props);
  }

  handleChange(event) {
    Preferences.set(this.props.pref, event.target.checked);
    // The state for these prefs are external (ie, in the Fx prefs store), so
    // force an update.
    this.forceUpdate();
  }

  render() {
    let checked = !!Preferences.get(this.props.pref);
    let props = { type: "checkbox", defaultChecked: checked, onChange: event => this.handleChange(event) };
    return React.createElement("div", null,
          React.createElement("input", props),
          React.createElement("span", null, this.props.label)
    );
  }
}

// A textbox that allows a "number of days" pref value that's (poorly) tied
// to a Firefox preference value.
class NumDaysInput extends React.Component {
  constructor(props) {
    super(props);
  }

  handleChange(event) {
    let numberOfDays = parseInt(event.target.value);
    if (!isNaN(numberOfDays)) {
      let numberOfSeconds = numberOfDays * 24 * 60 * 60;
      Preferences.set(this.props.pref, numberOfSeconds);
    }
    // The state for these prefs are external (ie, in the Fx prefs store), so
    // force an update.
    this.forceUpdate();
  }

  render() {
    let numberOfSeconds = Preferences.get(this.props.pref);
    let numberOfDays = Math.floor(numberOfSeconds / 60 / 60 / 24);
    let checked = !!Preferences.get(this.props.pref);
    let props = { type: "text", value: numberOfDays, onChange: event => this.handleChange(event) };
    return React.createElement("div", null,
          React.createElement("span", null, this.props.label),
          React.createElement("input", props)
    );
  }
}

const ENGINE_PREFS = [
  "services.sync.log.logger.engine.addons",
  "services.sync.log.logger.engine.apps",
  "services.sync.log.logger.engine.bookmarks",
  "services.sync.log.logger.engine.clients",
  "services.sync.log.logger.engine.forms",
  "services.sync.log.logger.engine.history",
  "services.sync.log.logger.engine.passwords",
  "services.sync.log.logger.engine.prefs",
  "services.sync.log.logger.engine.tabs",
];

// The general "logging config" component.
class LoggingConfig extends React.Component {
  render() {
    return React.createElement("div", null,
            React.createElement(LogLevelComponent,
                                { label: "Level of messages written by Sync engines",
                                  prefs: ENGINE_PREFS,
                                }),
            React.createElement(LogLevelComponent,
                                { label: "Level of messages written to about:sync-logs log files",
                                  prefs: ["services.sync.log.appender.file.level"],
                                }),
            React.createElement(LogLevelComponent,
                                { label: "Level of messages written to dump - useful primarily for developers",
                                  prefs: ["services.sync.log.appender.dump"],
                                }),
            React.createElement(NumDaysInput,
                                { label: "Number of days to keep log files for:",
                                  pref: "services.sync.log.appender.file.maxErrorAge",
                                }),
            React.createElement(PrefCheckbox,
                                { label: "Create log files even on success?",
                                  pref: "services.sync.log.appender.file.logOnSuccess",
                                }),
            React.createElement(PrefCheckbox,
                                { label: "Remember these values when Sync is reconfigured?",
                                  pref: "extensions.aboutsync.applyOnStartOver",
                                })
    );
  }
}

// Matches logfiles, captures timestamp.
const LOG_FILE_RE = /^\w+-\w+-(\d+)\.txt$/;

// Format a ms-since-1970 timestamp as a string that will be consistent across
// locales
function timestampToTimeString(ts) {
  // toISOString() throws for invalid dates.
  try {
    let d = new Date(+ts);
    let s = d.toISOString();
    return s.replace("T", " ").replace("Z", '');
  } catch (e) {
    return `<Illegal Date ${ts}>`;
  }
}

function formatMS(ts) {
  let ms = String(ts % 1000).padStart(3, "0");
  let sec = String(Math.floor(ts / 1000) % 60).padStart(2, "0");
  let min = String(Math.floor(ts / (1000 * 60)) % 60).padStart(2, "0");
  let hrs = String(Math.floor(ts / (1000 * 60 * 60))).padStart(2, "0");
  return `${hrs}:${min}:${sec}.${ms}`;
}

// The main component for managing log files - also enumerates the file-system
// for the individual files and can create a .zip file from the,
class LogFilesComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      logFiles: null,
      downloadingCombined: null
    };
  }

  // Makes a simple .zip file and "downloads" it.
  // NOTE that this could possibly be improved by concatenating all log files
  // in "last modified" order into a single txt file, along with other
  // diagnostic ifo, ready for upload into bugzilla - that would make it
  // easier for the developer to peruse and get a complete picture of the session.

  // Eg, I could see the file being of the form:
  // ---- 8< ---- cut here ---- 8< ----
  // [addons]
  // { dynamically generated list of addons here. }
  // [preferences]
  // { dynamically generated list of about:troubleshooting preferences here. }
  // ...
  // [log logfilename]
  // { contents of the first logfile }
  // [log logfilename]
  // etc.

  // But for now it is just a simple .zip file of every log file we could find.
  async downloadZipFile() {
    let logFilenames = [];
    let zipWriter = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);

    // Create the file in ${TempDir}/mozilla-temp-files
    let zipFile = FileUtils.getFile("TmpD",
      ["mozilla-temp-files", "aboutsync-logfiles.zip"]);
    console.log("Creating zip", zipFile.path);
    // *sob*
    const PR_RDWR        = 0x04;
    const PR_CREATE_FILE = 0x08;
    const PR_TRUNCATE    = 0x20;

    zipWriter.open(zipFile, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);

    for (let entry of this.state.logFiles.entries) {
      let logfile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      logfile.initWithPath(entry.path);
      zipWriter.addEntryFile(logfile.leafName,
                             Ci.nsIZipWriter.COMPRESSION_DEFAULT,
                             logfile, false);
    }
    zipWriter.close();
    // Now start the "download" of the file.
    // This seems much more difficult than it should be!
    try {
      await this.downloadFile(Services.io.newFileURI(zipFile), "aboutsync-logfiles.zip");
    } catch(err) {
      console.error("Failed to download zipfile", err);
    }
  }

  async downloadFile(sourceFileURI, targetFilename) {
    let downloadsDir = await Downloads.getPreferredDownloadsDirectory();
    let filename = await OS.Path.join(downloadsDir, targetFilename);
    // need to nuke an existing file first.
    if ((await OS.File.exists(filename))) {
      await OS.File.remove(filename);
    }
    let download = await Downloads.createDownload({
      source: sourceFileURI,
      target: filename,
    });
    // Add it to the "downloads" list.
    let list = await Downloads.getList(Downloads.PUBLIC);
    list.add(download);
    await download.start();
    // Show the file in Explorer/Finder/etc
    await download.showContainingDirectory();
  }

  // Oldest first, filters out ones that don't match LOG_FILE_RE
  _getOrderedLogFiles() {
    return this.state.logFiles.entries
    .filter(entry => {
      if (entry.isDir || entry.isSymLink) {
        return false;
      }
      let m = entry.name.match(LOG_FILE_RE);
      if (!m) {
        return false;
      }
      return !isNaN(+m[1])
    }).sort((a, b) => {
      return (+a.name.match(LOG_FILE_RE)[1]) - (+b.name.match(LOG_FILE_RE)[1])
    });
  }

  async _downloadCombined() {
    let files = this._getOrderedLogFiles();
    this.setState({
      downloadingCombined: {
        current: 0,
        total: files.length
      }
    });

    let tmpFileInfo = await OS.File.openUnique(
      OS.Path.join(OS.Constants.Path.tmpDir, 'aboutsync-combined-log.txt'))

    try {
      let textEncoder = new TextEncoder();
      // as in cstdio
      async function puts(string) {
        return tmpFileInfo.file.write(textEncoder.encode(string + "\n"));
      }

      await puts(`Processing ${files.length} files`);
      let idx = 0;
      for (let entry of files) {
        let writeDate = entry.name.match(LOG_FILE_RE)[1];
        await puts(`\nLog file: ${entry.name} (written on ${timestampToTimeString(writeDate)})`);
        this.setState({
          downloadingCombined: {
            current: ++idx,
            total: files.length
          }
        });
        let entireFile = await OS.File.read(entry.path, { encoding: "UTF-8" });
        let entireFileLines = entireFile.split('\n');

        if (entireFileLines.length == 0) {
          // Shouldn't happen.
          await puts("File is empty!");
          continue;
        }

        // This should usually/always be on the first line.
        let firstTimestamp = +entireFileLines.find(line => line.split('\t')[0]).split('\t')[0];

        // Fake buffered input. await puts() for each line is far too slow.
        let outLines = [`First timestamp: ${firstTimestamp} (${timestampToTimeString(firstTimestamp)})`];

        for (let line of entireFileLines) {
          // Indent these lines so that text editors like sublime text will be
          // able to collapse the whole file from the sidebar.
          try {
            let [ts, ...rest] = line.split('\t');
            let diff = Number(ts) - firstTimestamp;
            outLines.push(`  ${timestampToTimeString(ts)} (${formatMS(diff)})    ${rest.join('\t')}`);
          } catch (e) {
            outLines.push(`  ${line}`);
          }
        }
        await puts(outLines.join("\n"));
      }
    } finally {
      await tmpFileInfo.file.close();
    }
    this.setState({
      downloadingCombined: {
        current: files.length,
        total: files.length
      }
    });

    await this.downloadFile(OS.Path.toFileURI(tmpFileInfo.path), "aboutsync-combined-log.txt");
  }

  async downloadCombined() {
    try {
      await this._downloadCombined();
    } catch (e) {
      console.error("Failed to download combined", e);
    }
    this.setState({
      downloadingCombined: null
    });
  }

  componentDidMount() {
    // find all our log-files.
    let logDir = FileUtils.getDir("ProfD", ["weave", "logs"]);
    let iterator = new OS.File.DirectoryIterator(logDir.path);

    let result = {
      entries: [],
      numErrors: 0,
    }
    iterator.forEach(entry => {
      result.entries.push(entry);
      result.numErrors += entry.name.startsWith("error-") ? 1 : 0;
    }).then(() => {
      this.setState({ logFiles: result });
    }).catch(err => {
      console.error("Failed to fetch the logfiles", err);
    });
  }

  _processing(kind, {current, total}) {
    if (current == total) {
      return `finishing ${kind}`
    } else {
      return `processing ${kind} (${current} / ${total})`
    }
  }

  render() {
    let logFiles = this.state.logFiles;
    let details = [React.createElement("legend", null, "Log Files")];
    if (logFiles == null) {
      details.push(React.createElement(Fetching, { label: "Looking for log files..." }));
    } else if (!logFiles.entries.length) {
      details.push(React.createElement("span", null, "No news is good news; there are no log files"));
    } else {
      // summarize them - by default, they will all be errors.
      details.push(React.createElement("span", null,
                                       `${logFiles.numErrors} error logs, ${logFiles.entries.length} in total`));
      details.push(React.createElement("span", null, " - "));
      details.push(React.createElement(InternalAnchor, { href: "about:sync-log" },
                                       "view them locally"));
      details.push(React.createElement("span", null, ", "));
      if (this.state.downloadingCombined) {
        details.push(React.createElement("span", null,
          this._processing("combined log file", this.state.downloadingCombined)));
      } else {
        details.push(React.createElement("a", { href: "#", onClick: event => this.downloadCombined(event) },
                                         "download a combined summary"));
      }
      details.push(React.createElement("span", null, ", or "));
      details.push(React.createElement("a", { href: "#", onClick: event => this.downloadZipFile(event) },
                                       "download them as a zip file"));
    }
    details.push(React.createElement(LoggingConfig, null));

    return React.createElement("fieldset", null, ...details);
  }
}

// Options for the addon itself.
class AddonPrefsComponent extends React.Component {
  constructor(props) {
    super(props);
  }

  render() {
    let details = [React.createElement("legend", null, "Addon Options"),
                   React.createElement(PrefCheckbox,
                                   { label: "Hide notification on sync errors?",
                                     pref: "extensions.aboutsync.hideNotifications",
                                   }),
    ];
    return React.createElement("fieldset", null, ...details);
  }
}

// The top-level options.
class PrefsComponent extends React.Component {
  constructor(props) {
    super(props);
  }

  render() {
    return React.createElement("div", { className: "logLevel" },
            React.createElement(LogFilesComponent, null),
            React.createElement(AddonPrefsComponent, null),
    );
  }
}

module.exports = { PrefsComponent };
