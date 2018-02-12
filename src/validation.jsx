const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const React = require("react");
const { ObjectInspector } = require("./common");
const { TableInspector } = require("./AboutSyncTableInspector");

function ProblemList({desc, ids, map}) {
  if (!ids || !ids.length) {
    return null;
  }
  return (
    <div>
      <p>{desc}</p>
      <TableInspector data={ids.map(id => map.get(id))}/>
    </div>
  );
}

function IdDesc({id, clientMap, serverMap}) {
  let descs = [];
  let childItem = clientMap.get(id);
  if (childItem) {
    descs.push(`Exists locally with title "${childItem.title}"`);
  } else {
    descs.push("Does not exist locally");
  }
  let serverItem = serverMap.get(id);
  if (serverItem) {
    descs.push(`Exists on the server with title "${serverItem.title}"`);
  } else {
    descs.push("Does not exist on the server");
  }
  let desc = descs.join("\n");

  return (
    <span className="inline-id" title={desc}>{id}</span>
  );
}

// Maps the name of a validation problem to a component type that can handle it.
// Each is passed props of: problems, clientMap, serverMap, serverRecords, and
// clientRecords. This is the default for most types, see
// BookmarkHandlers for the ones used for bookmark validation
const DefaultHandlers = {
  missingIDs: props => (
    <p>There are {props.problems.missingIDs} records without IDs.</p>
  ),

  clientMissing: props => (
    <ProblemList desc="The following server records appear on the server but not on the client."
                 ids={props.problems.clientMissing}
                 map={props.serverMap}/>
  ),

  serverUnexpected: props => (
    <ProblemList desc="The following server records appear on the server but should not have been uploaded."
                 ids={props.problems.serverUnexpected}
                 map={props.serverMap}/>
  ),

  serverMissing: props => (
    <ProblemList desc="The following records appear on the client but not on the server."
                 ids={props.problems.serverMissing}
                 map={props.clientMap}/>
  ),

  serverDeleted: props => (
    <ProblemList desc="The following records appear on the client but were marked as deleted on the server."
                 ids={props.problems.serverDeleted}
                 map={props.clientMap}/>
  ),

  duplicates: props => (
    props.problems.duplicates.map(dupeId => (
      <div key={dupeId}>
        <p>The id <IdDesc id={dupeId} {...props}/> appears multiple times on the server</p>
        <TableInspector data={props.serverRecords.filter(r => r.id === dupeId)}/>
      </div>
    ))
  ),

  differences: props => (
    props.problems.differences.map(({id, differences}) => (
      <div key={id}>
        <p>Record <IdDesc id={dupeId} {...props}/> has differences between local and server copies.</p>
        <TableInspector data={differences.map(field => {
          return {
            field,
            local: props.clientMap.get(id)[field],
            server: props.serverMap.get(id)[field]
          }
        })}/>
      </div>
    ))
  ),
};

// Takes props of problems, clientMap, serverMap, serverRecords, as well as
// a set of handlers, and renders them.
class ResultDisplay extends React.Component {
  static get defaultProps() {
    return {
      handlers: DefaultHandlers
    };
  }

  render() {
    let unknown = [];
    let rendered = [];

    for (let {name, count} of this.props.problems.getSummary()) {
      if (count == 0) {
        continue;
      }
      if (this.props.handlers[name]) {
        let HandlerClass = this.props.handlers[name];
        rendered.push(<HandlerClass key={name} {...this.props}/>);
      } else {
        unknown.push({ name, count, data: problems[name] });
      }
    }
    if (rendered.length == 0 && unknown.length == 0) {
      return <p>{"No validation problems found \\o/"}</p>;
    }
    return (
      <div>
        {rendered}
        {unknown.length > 0 && (
          <div>
            <p>Found {unknown.length} problems that about:sync doesn't (yet) render</p>
            <TableInspector data={unknown}/>
          </div>
        )}
      </div>
    );
  }
}

function bookmarkDifference(id, field, clientMap, serverMap) {
  let result = {
    id,
    field,
    localRecord: clientMap.get(id),
    serverRecord: serverMap.get(id),
  };
  if (result.localRecord) {
    result.localValue = result.localRecord[field];
  }

  if (result.serverRecord) {
    result.serverValue = result.serverRecord[field];
  }
  return result;
}

const BookmarkHandlers = Object.assign({}, DefaultHandlers, {
  rootOnServer: props => (
    <p>The root is present on the server, but should not be.</p>
  ),
  missingChildren: props => (
    props.problems.missingChildren.map(({parent, child}) => (
      <div key={`${parent}:${child}`}>
        <p>
          Server record references child <IdDesc id={child} {...props}/> which
          doesn't exist on the server.
        </p>
        <ObjectInspector name="parent" data={props.serverMap.get(parent)}/>
        {props.clientMap.get(child) && [
          <p key="client-child-desc">A record with this ID exists on the client:</p>,
          <ObjectInspector key="client-child-inspector" data={props.clientMap.get(child)}/>
        ]}
      </div>
    ))
  ),
  multipleParents: props => (
    props.problems.multipleParents.map(({parents, child}) => (
      <div key={child}>
        <p>Child record <IdDesc id={child} {...props}/> appears as a child in multiple parents.</p>
        <ObjectInspector data={props.clientMap.get(child)}/>
        <TableInspector data={parents.map(p => props.serverMap.get(p))}/>
      </div>
    ))
  ),
  parentChildMismatches: props => (
    props.problems.parentChildMismatches.map(({parent, child}) => (
      <div key={`${parent}:${child}`}>
        <p>
          Server-side parent/child mismatch for parent <IdDesc id={parent} {...props}/> (first)
          and child <IdDesc id={child} {...props}/> (second).
        </p>
        <ObjectInspector name="Parent" data={props.serverMap.get(parent)}/>
        <ObjectInspector name="Child" data={props.serverMap.get(child)}/>
      </div>
    ))
  ),

  cycles: props => (
    props.problems.cycles.map((cycle, i) => (
      <div key={cycle.join(',')}>
        <p>Cycle detected through {cycle.length} items on server</p>
        <TableInspector data={cycle.map(id => props.serverMap.get(id))}/>
      </div>
    ))
  ),

  orphans: props => (
    <div>
      <p>The following server records are orphans</p>
      <TableInspector data={props.problems.orphans.map(({ id, parent }) => ({
        childID: id,
        parentID: parent,
        child: props.serverMap.get(id),
        parent: props.serverMap.get(parent),
        clientChild: props.clientMap.get(id),
        clientParent: props.clientMap.get(parent),
      }))}/>
    </div>
  ),

  clientMissing: props => (
    <ProblemList desc="The following server records appear on the server but not on the client."
                 ids={props.problems.clientMissing}
                 map={props.serverMap}/>
  ),

  deletedParents: props => (
    <ProblemList desc="The following server records have deleted parents not deleted but had a deleted parent."
                 ids={props.problems.deletedParents}
                 map={props.serverMap}/>
  ),

  duplicateChildren: props => (
    <ProblemList desc="The following server records had the same child id multiple their children lists."
                 ids={props.problems.duplicateChildren}
                 map={props.serverMap}/>
  ),

  parentNotFolder: props => (
    <ProblemList desc="The following server records had a non-folder for a parent."
                 ids={props.problems.parentNotFolder}
                 map={props.serverMap}/>
  ),

  childrenOnNonFolder: props => (
    <ProblemList desc="The following server records were not folders but contained children."
                 ids={props.problems.childrenOnNonFolder}
                 map={props.serverMap}/>
  ),

  clientMissing: props => (
    <ProblemList desc="The following server records appear on the server but not on the client."
                 ids={props.problems.clientMissing}
                 map={props.serverMap}/>
  ),

  serverUnexpected: props => (
    <ProblemList desc="The following server records appear on the server but should not have been uploaded."
                 ids={props.problems.serverUnexpected}
                 map={props.serverMap}/>
  ),

  serverMissing: props => (
    <ProblemList desc="The following records appear on the client but not on the server."
                 ids={props.problems.serverMissing}
                 map={props.clientMap}/>
  ),

  serverDeleted: props => (
    <ProblemList desc="The following records appear on the client but were marked as deleted on the server."
                 ids={props.problems.serverDeleted}
                 map={props.clientMap}/>
  ),

  differences: props => (
    props.problems.differences.map(({id, differences}) => (
      <div key={id}>
        <p>Record <IdDesc id={dupeId} {...props}/> has differences between local and server copies.</p>
        <TableInspector data={differences.map(field => bookmarkDifference(id, field, clientMap, serverMap))}/>
      </div>
    ))
  ),

  structuralDifferences: props => (
    props.problems.structuralDifferences.map(({id, differences}) => (
      <div key={id}>
        <p>Record <IdDesc id={dupeId} {...props}/> has differences between local and server copies.</p>
        <TableInspector data={differences.map(field => bookmarkDifference(id, field, clientMap, serverMap))}/>
      </div>
    ))
  ),
});

module.exports = {
  ResultDisplay,
  DefaultHandlers,
  BookmarkHandlers,
};
