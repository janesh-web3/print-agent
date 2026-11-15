# Print agent

A small program that runs on a venue's reception PC. The server sends it the
kitchen, bar and bill tickets for that venue; it prints them on the venue's
printers and tells the server how each one went. It starts by itself when the PC
does, with nobody logged in, and survives power cuts.

The agent is the only thing that prints automatically: the browser never opens a
print window or dialog by itself. For a step-by-step setup of a new restaurant or
hotel, open [auto-print-setup.html](auto-print-setup.html) (also copied into the
installer folder).

## Installing on a venue PC

Build the installable folder once, on a Windows machine:

```
npm install
npm run package          # makes release\rms-print-agent-<version>\
```

That folder holds the agent, its dependencies and its own `node.exe`; the venue
PC needs nothing installed. For each venue:

1. In the restaurant's settings, add a print agent. It shows a **one-time code**
   (valid for 24 hours, usable once).
2. Copy the folder to the PC, e.g. `C:\Program Files\RMS Print Agent`.
3. Open a command prompt **as administrator** and, from that folder:

   ```
   print-agent enrol --server https://YOUR-SERVER --code XXXX-XXXX-XXXX
   ```

4. `print-agent install` — starts it now and at every boot.
5. In the restaurant's settings (Settings → Printing), add the printers and
   press **Send test page** on each. The server sends them to the agent; nothing
   is edited on the PC (below).
6. `print-agent status` — shows whether it is enrolled, installed and running,
   and the last few log lines.

`print-agent uninstall` removes it from boot (settings, queue and log stay).
To move the agent to another PC, make a new code for it in the settings and
repeat from step 2: the old PC is switched off the moment the new one enrols.
`INSTALL.txt` in the folder has these steps for the person doing it.

## What lives where

Everything is in `C:\ProgramData\RMS Print Agent` (set `PRINT_AGENT_HOME` to move
it, for development):

| File | Holds |
|---|---|
| `agent.json` | What this PC was enrolled as. No secrets. |
| `credentials.json` | The sign-in token, **encrypted** with Windows DPAPI (machine scope): the file is useless copied to any other PC. |
| `printers.json` | This venue's printers, as the server last sent them (below). |
| `queue.db` | Tickets received and not yet reported. |
| `logs\agent.log` | What the agent did, and why a ticket did not print. Rotates at 5 MB, keeps the last 5. |
| `agent.lock` | Present while an agent runs; stops a second one starting. |

`enrol` locks the folder to administrators and the SYSTEM account, so other
users of the PC cannot read the credentials. The token never appears on screen
or in the log.

## What it guarantees

- A ticket is saved to disk before anything else happens to it, so a power cut
  loses nothing the server already handed over.
- The same ticket arriving twice is printed once.
- A failed print is retried with a growing delay (2s, 4s … up to 30s) for up to
  10 minutes. After that the ticket is reported as failed, not printed: a
  kitchen should not get a ticket for a table that has moved on.
- A ticket that can never print (no printers set up yet, or its printer is not
  one of them) is reported as failed straight away, with the reason, not
  retried. It shows up on the staff screens as NOT PRINTED, with a Reprint
  button.
- A ticket that printed but could not be reported (no internet) is reported on
  the next connection, and not printed again.
- A ticket that sat in the queue while the PC was off for more than 10 minutes
  is not printed when the PC comes back; it is reported as failed.
- Only one agent can run per install, so a second one started by hand cannot
  make every ticket print twice.
- If the agent crashes or is stopped, Windows starts it again (within a minute
  after a crash, within five after a clean stop).
- One caveat: a power cut at the exact moment a ticket is being printed can
  produce one duplicate. A duplicate is the lesser evil.

The server sees the agent's version, how many tickets it holds, when it last
printed and its latest error, every 30 seconds, so "online but stuck" can be
told from "healthy".

## Printers

Printers are managed on the server, in Settings → Printing: a network printer's
address, or a USB printer's Windows name, with its paper width. The server
sends the list to the agent when it connects and whenever it changes, and the
agent keeps a copy in `printers.json` so it still knows them after a reboot with
no internet. Nobody edits files on the venue PC.

The server only addresses tickets by label (`Kitchen_Printer`, `Bar_Printer`,
`Bill_Printer`, or whatever the venue named them); the registry says what each
one is at this venue:

- A ticket goes to the printer named in the ticket; anything not listed goes to
  the first printer. A venue with one printer lists just that one and everything
  uses it.
- `network` printers take raw ESC/POS on port 9100 (the usual). Give them a
  fixed IP (a DHCP reservation on the router).
- `windows` printers are USB ones. The name is exactly what Windows calls the
  printer (`Get-Printer` in PowerShell lists them). Bytes go through the Windows
  spooler as RAW data, so no driver rendering gets in the way.
- Columns: 48 for a standard 80 mm roll (default), 32 for 58 mm.
- Cut: off for a printer without a cutter.
- Status check (network only, default on): before sending, ask the printer if
  it is out of paper, offline or has its cover open, and retry later instead of
  sending a ticket into a printer that cannot print it. Printers that do not
  answer are sent to anyway.

If the server has sent no printers, tickets fail with "No printers are set up"
rather than being thrown away — the staff see them as NOT PRINTED. An empty
list from the server never overwrites a `printers.json` written by hand
(`printers.example.json` shows the format); that is the way to run an agent
without the server's registry, for a test bench.

To check an install before any printer is wired up, set `PRINT_AGENT_DRY_RUN=true`
for the service: tickets are written to the log and reported as printed. Never
leave this on at a venue — nothing comes out of a printer.

## Know the limits

- **Text is plain ASCII.** Receipt printers have no Unicode. Accents are
  dropped, and Nepali (Devanagari) script or emoji print as `?`. That is
  deliberate — a visible `?` gets noticed. Current menu data is English.
- **A network printer says nothing back.** "Printed" means the bytes were
  handed over, not that paper came out. The status check catches the common
  causes (no paper, cover open) on printers that support it.
- **USB status is Windows' view.** Windows reports offline and paper-out for
  some printers and says "Normal" for others, depending on the driver.
- **A USB ticket takes a second or two longer** than a network one, because
  each starts a PowerShell run (1–5 s depending on how busy the PC is).
- **The agent does not poll printers for status in the background.** A poll can
  collide with a ticket on printers that take one connection at a time. Status
  is only checked just before a send.

## Not yet verified on real hardware

The test suite runs the real agent, kills it like a power cut, and checks that
nothing is lost or doubled; registers and starts a real Windows scheduled task
(for the test user); and seals a token with the real DPAPI. What it cannot do
here is act as an administrator or touch a thermal printer, so these need doing
once, by hand, at the first pilot venue:

- [ ] `print-agent enrol` as administrator: the folder is then readable only by
      SYSTEM and Administrators (`icacls "C:\ProgramData\RMS Print Agent"`).
- [ ] `print-agent install`: `print-agent status` shows the boot job
      *Running*; the boot-time task definition itself is only checked for shape,
      because registering a boot trigger needs administrator rights.
- [ ] Restart the PC without logging in: tickets still print.
- [ ] Pull the power plug while a ticket is queued: after power returns, it
      prints once (or is reported failed if more than 10 minutes old).
- [ ] End the `node.exe` process in Task Manager: it is back within a minute.
- [ ] One ticket of each kind on each real printer: width, cut, status reply,
      and a USB ticket end to end.

## How it fits together

| File | Does |
|---|---|
| `src/index.ts` | The agent: what the boot job runs |
| `src/cli.ts` | `enrol`, `install`, `uninstall`, `status`, `run` |
| `src/agent.ts` | The rules above |
| `src/jobQueue.ts` | The on-disk queue |
| `src/serverLink.ts` | The socket connection, reports and heartbeat |
| `src/enrol.ts`, `src/credentials.ts`, `src/config.ts`, `src/home.ts` | Getting and keeping credentials and settings |
| `src/windowsService.ts` | The boot job (Task Scheduler) and locking down the folder |
| `src/singleInstance.ts`, `src/logger.ts` | One agent at a time; the rotating log |
| `src/layout.ts`, `src/escpos.ts` | What goes on the paper, and the printer commands |
| `src/transports.ts`, `src/printerConfig.ts`, `src/escposPrinter.ts` | Reaching the printers |

The agent signs in with its token and is placed in a room of its own on the
server, so it never receives orders, bills or payments — only its tickets.

## Tests

```
npm test
```

`backend/src/__tests__/integration/printAgent.int.test.ts` and
`printDevices.int.test.ts` also run this agent against the real server and a
real database, from enrolment and an order to bytes arriving at a (fake) printer.
