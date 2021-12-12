require('dotenv').config()
const Moobarn = require('./moobarn')
const pkg = require('./package.json')

const launcher_timeout = process.env.LAUNCHER_TIMEOUT_MILLISECONDS

const help_cmd = ['help', '-h', '--help']
const version_cmd = ['version', '-v', '--version']
const info_cmd = ['info', 'status', 'stat']
const debug_cmd = ['test', 'bootloop']
const cmd_list = ['init', 'start', 'stop', 'backup', 'list', 'scan', ...version_cmd, ...help_cmd, ...info_cmd, ...debug_cmd]

const help_msg = `
MOOBARN :: MOO Bridge API for React and Node

    help/-h/--help/                   print this information
    version/-v/--version              print the current package version for moobarn
    init <moo-name> from <moo-db>     initialize a new moo to ./barn/<moo-name> from ./dbs/<moo-db>/<moo-db>.db
    start [moo-name] [port]           start [moo-name] on port [port], or all moos if nothing specified
    stop [moo-name]                   stop [moo-name], or all moos if nothing specified
    backup [moo-name]                 back up [moo-name], or all moos if nothing specified
    list                              print a list of all moos in ./barn and their current status
    scan                              scan this system for any moo-related processes
    info/status [moo-name]            print detailed info about [moo-name], or all moos if nothing specified

If no arguments are provided, moobarn will simply initialize and start running in the current shell.
`

const command = process.argv[2]
const moo = process.argv[3]
const prep_or_port = process.argv[4]
const source_db = process.argv[5]

const invalid_cmd_error = 'ERROR: Invalid command format'

if (!cmd_list.includes(command) && command) {
  console.log(invalid_cmd_error)
  console.log(help_msg)
  process.exit()
}

// handle help
if (help_cmd.includes(command) || (!cmd_list.includes(command) && command)) {
  console.log(help_msg)
  process.exit()
}

// handle version
if (version_cmd.includes(command)) {
  console.log(pkg.version)
  process.exit()
}

// initialize moobarn
const server = new Moobarn()

// start the server
if (!command || command === 'bootloop') {
  server.start('verbose')
  server.controllers.get('process').resurrect()
} else {
  server.start()
}

// handle scan
if (command === 'scan') {
  server.controllers.get('process').findMooProcesses('pretty')
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle list
if (command === 'list') {
  server.listAllMoos()
  process.exit()
}

// handle info
if (info_cmd.includes(command)) {
  if (!moo) {
    server.printAllInfo()
  } else {
    server.printInfo(moo)
  }
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle start
if (command === 'start') {
  if (!moo) {
    server.controllers.get('process').startAll()
  } else {
    server.controllers.get('process').startMoo(moo, prep_or_port)
  }
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle stop
if (command === 'stop') {
  if (!moo) {
    server.controllers.get('process').stopAll()
  } else {
    server.controllers.get('process').stopMoo(moo)
  }
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle backup
if (command === 'backup') {
  if (!moo) {
    server.controllers.get('backup').backupAll(true)
  } else {
    server.controllers.get('backup').backupMoo(moo)
  }
  process.exit()
}

// handle init
if (command === 'init') {
  if (!moo || !prep_or_port || prep_or_port !== 'from' || !source_db) {
    console.log(invalid_cmd_error)
    console.log(help_msg)
    process.exit()
  }

  server.initMoo(moo, source_db)
  process.exit()
}

// handle test
if (command === 'test') {
  console.log('\n(this space intentionally left blank)\n')
  setTimeout(() => {
    process.exit()
  }, launcher_timeout)
}

// handle bootloop
if (command === 'bootloop') {
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
