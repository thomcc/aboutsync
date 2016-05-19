// Components and other code for managing the friendlier Sync prefs management
// offered by this addon.
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

// The main component for managing log files - also enumerates the file-system
// for the individual files and can create a .zip file from the,
class LogFilesComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = { logFiles: null };
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
  downloadZipFile() {
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
    Task.spawn(function* () {
      let downloadsDir = yield Downloads.getPreferredDownloadsDirectory();
      let filename = yield OS.Path.join(downloadsDir, "aboutsync-logfiles.zip");
      // need to nuke an existing file first.
      if ((yield OS.File.exists(filename))) {
        yield OS.File.remove(filename);
      }
      let download = yield Downloads.createDownload({
        source: Services.io.newFileURI(zipFile),
        target: filename,
      });
      // Add it to the "downloads" list.
      let list = yield Downloads.getList(Downloads.PUBLIC);
      list.add(download);
      yield download.start();
      // Show the file in Explorer/Finder/etc
      yield download.showContainingDirectory();
    }).catch(err => {
      console.error("Failed to download zipfile", err);
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
      details.push(React.createElement("span", null, " or "));
      details.push(React.createElement("a", { href: "#", onClick: event => this.downloadZipFile(event) },
                                       "download them as a zip file"));
    }
    details.push(React.createElement(LoggingConfig, null));

    return React.createElement("fieldset", null, ...details);
  }
}
