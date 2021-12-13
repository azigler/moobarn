require('dotenv').config()
const Moobarn = require('./moobarn')
const pkg = require('./package.json')

const launcher_timeout = process.env.LAUNCHER_TIMEOUT_MILLISECONDS

const help_cmd = ['help', '-h', '--help']
const version_cmd = ['version', '-v', '--version']
const info_cmd = ['info', 'status', 'stat']
const debug_cmd = ['test', 'bootloop']
const cmd_list = ['init', 'start', 'stop', 'backup', 'list', 'scan', 'bridge', ...version_cmd, ...help_cmd, ...info_cmd, ...debug_cmd]

const help_msg = `
MOOBARN :: MOO Bridge API for React and Node

    help/-h/--help/                   print this information
    version/-v/--version              print the current package version for moobarn
    init <moo-name> from <moo-db>     initialize a new moo to ./barn/<moo-name> from ./dbs/<moo-db>/<moo-db>.db
    start [moo-name] [port]           start [moo-name] on port [port], or all moos if nothing specified
    stop [moo-name]                   stop [moo-name], or all moos if nothing specified
    backup [moo-name]                 back up [moo-name], or all moos if nothing specified
    list                              print a list of all moos in ./barn
    scan                              scan this system for any moo-related processes
    bridge [scan]                     print a list of all bridges, or scan for related processes
    info/status [moo-name]            print detailed info about [moo-name], or all moos if nothing specified

If no arguments are provided, moobarn will simply initialize and start running in the current shell.
`

const arg_1 = process.argv[2]
const arg_2 = process.argv[3]
const arg_3 = process.argv[4]
const arg_4 = process.argv[5]

const invalid_cmd_error = 'ERROR: Invalid command format'

if (!cmd_list.includes(arg_1) && arg_1) {
  console.log(invalid_cmd_error)
  console.log(help_msg)
  process.exit()
}

// handle help
if (help_cmd.includes(arg_1) || (!cmd_list.includes(arg_1) && arg_1)) {
  console.log(help_msg)
  process.exit()
}

// handle version
if (version_cmd.includes(arg_1)) {
  console.log(pkg.version)
  process.exit()
}

// initialize moobarn
const server = new Moobarn()

// start the server
if (!arg_1 || arg_1 === 'bootloop') {
  server.start('verbose')
  server.controllers.get('process').resurrect()
  server.controllers.get('bridge').resurrect()
} else {
  server.start()
}

// handle scan
if (arg_1 === 'scan') {
  server.controllers.get('process').findMooProcesses('pretty')
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle bridge
if (arg_1 === 'bridge') {
  if (arg_2 === 'scan') {
    server.controllers.get('bridge').findBridgeProcesses('pretty')
    setTimeout(() => {
      process.exit()
    }, launcher_timeout)
  } else {
    server.controllers.get('bridge').listAllBridges()
    process.exit()
  }
}

// handle list
if (arg_1 === 'list') {
  server.listAllMoos()
  process.exit()
}

// handle info
if (info_cmd.includes(arg_1)) {
  if (!arg_2) {
    server.printAllInfo()
  } else {
    server.printInfo(arg_2)
  }
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle start
if (arg_1 === 'start') {
  if (!arg_2) {
    server.controllers.get('process').startAll()
  } else {
    server.controllers.get('process').startMoo(arg_2, arg_3)
  }
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle stop
if (arg_1 === 'stop') {
  if (!arg_2) {
    server.controllers.get('process').stopAll()
  } else {
    server.controllers.get('process').stopMoo(arg_2)
  }
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle backup
if (arg_1 === 'backup') {
  if (!arg_2) {
    server.controllers.get('backup').backupAll(true)
  } else {
    server.controllers.get('backup').backupMoo(arg_2)
  }
  process.exit()
}

// handle init
if (arg_1 === 'init') {
  if (!arg_2 || !arg_3 || arg_3 !== 'from' || !arg_4) {
    console.log(invalid_cmd_error)
    console.log(help_msg)
    process.exit()
  }

  server.initMoo(arg_2, arg_4)
  process.exit()
}

// handle test
if (arg_1 === 'test') {
  console.log('\n(this space intentionally left blank)\n')
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle bootloop
if (arg_1 === 'bootloop') {
  let looping = false

  const debugStop = () => {
    console.log('======STOPPING======')
    server.stop('verbose')
    if (!looping) setInterval(() => debugStop(), 40 * 1000)
  }

  const debugStart = () => {
    console.log('======STARTING======')
    server.start('verbose')
    if (!looping) setInterval(() => debugStart(), 40 * 1000)
  }

  setTimeout(() => {
    debugStop()
    setTimeout(() => {
      debugStart()
      looping = true
    }, 20000)
  }, 20000)
}
