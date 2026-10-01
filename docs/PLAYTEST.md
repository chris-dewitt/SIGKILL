# Playtesting

CI proves the game is *correct*. Nothing in CI can tell you whether it is any
good to hold in your hand, and that is the question the whole project turns on.
This is how to answer it.

Three loops. Use the cheapest one that can answer the question you have.

---

## 1. The phone browser — seconds

The dev server already binds every interface, so nothing needs configuring.

```bash
pnpm dev          # vite, 0.0.0.0:5173
```

Vite prints a `Network:` line with the machine's LAN address. Open that on the
phone, same Wi-Fi:

```
http://192.168.x.x:5173
```

On Windows the first run raises a firewall prompt — allow it on **private
networks only**. On Linux or WSL, open the port rather than disabling the
firewall:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 5173
```

Edits reload live, so this is the loop for anything about *the game*: whether
the chip bar is in thumb reach, whether the CRT reads on a real panel at real
brightness, whether a hint lands, how long Pyodide actually takes on a phone
CPU rather than a laptop's.

What it cannot tell you is anything about Android. A mobile browser is not the
WebView, its keyboard is not the app's keyboard, and it has a URL bar eating
the top of the screen.

---

## 2. The APK — minutes, and no local toolchain

Built in CI by `.github/workflows/apk.yml`, which produces
`sigkill-debug-<sha>` as a downloadable artifact.

- **Already built:** every merge to `main` has one attached to it. Actions →
  the run for that commit → Artifacts.
- **On demand:** Actions → **APK** → *Run workflow*. The button works from a
  phone browser, which means the whole loop can happen without a computer.

The artifact downloads as a zip holding `app-debug.apk`. Install it:

```bash
adb install -r app-debug.apk          # with a cable
```

Or unzip it on the phone and tap it — Android asks once for permission to
install from that app, and that grant is per-source, not global.

If the toolchain *is* installed locally, skip all of this:
`pnpm android:debug`. See [ANDROID.md](ANDROID.md).

### On a phone, tag it instead

An artifact is an **authenticated** zip. A browser that is not signed in to
GitHub gets a 404 rather than a login prompt, and GitHub's mobile layout often
renders the artifact row as text that will not tap at all — so the artifact
route tends to fail on the one device the game is built for.

A Release asset is a plain direct link. Tap it and Android installs. Tagging
publishes one:

```bash
git tag v0.1.0-playtest
git push origin v0.1.0-playtest
```

Any tag starting with `v` runs the same build, then attaches
`sigkill-<tag>.apk` to a GitHub Release marked as a prerelease.

**That asset is a public download.** This repository is public, so anybody
with the link gets a working build in one tap. The source is public under
Apache-2.0 and the APK is a debug package rather than a store build, so
nothing is leaked by it — but it is the difference between code somebody
could compile and a game they can play, which is why it is a tag you push
rather than something every merge does.

Delete a release and its asset from the repository's Releases page, and the
tag with `git push origin :refs/tags/<tag>`.

### What only this loop can tell you

- **The soft keyboard.** Does the prompt stay visible with it up, in both
  orientations? This is what `windowSoftInputMode="adjustResize"` exists for
  and the single most likely thing to silently regress.
- **The IME.** Autocorrect, prediction, swipe typing, a physical keyboard over
  Bluetooth. `|`, `>`, `$` and `/` on the system keyboard versus the symbol
  chips.
- **Safe areas.** Camera cutout, rounded corners, gesture bar.
- **The back gesture.** Where it goes mid-act, and in `vi`.
- **Cold launch.** From a cold package, after a reboot, which is the only
  honest measurement of it.
- **That it is genuinely offline.** Turn on airplane mode and play a whole
  act, start to finish. Nothing should stall and nothing should degrade.

A debug APK is `debuggable` by design, which is right for your own device and
wrong for handing out. Builds for other people come from loop 3.

If you would rather check the offline claim than take it:

```bash
$ANDROID_HOME/build-tools/35.0.0/aapt2 dump permissions app-debug.apk
```

It should name exactly one permission,
`…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which the app defines for itself
at signature level and which grants nothing outside it. The APK workflow runs
that same check over both the debug and the release package on every run, so
this is something you can confirm rather than something you have to trust.

---

## 3. Play internal testing — later, and deliberately

```bash
pnpm android:release    # app-release.aab
```

That needs a signing config, a key, and a store listing. Two standing rules:

- The keystore is **never** in the repository. `*.keystore` and `*.jks` are
  gitignored, and losing it means the listing can never be updated again.
- The keystore is not in CI either, unless that becomes a decision made on
  purpose. A signing key in Actions is a key that anybody who can push — or
  anybody who can land a workflow change — can sign a release with.

---

## The checklist

"It works" is not a playtest. One pass, in order, on a real device:

1. **Chooser.** Do all the games fit at 34 columns, no clipped titles?
2. **First command.** Type `ls /etc` without hunting for `/`. How many taps?
3. **A pipeline.** `cat /etc/passwd | grep root` — is `|` found quickly?
4. **Keyboard up.** Prompt visible? Rotate. Still visible?
5. **Scrollback.** Can you get back to what the ship said four commands ago?
6. **First Python command.** Time it. Does the game say anything while you
   wait, or does it look frozen?
7. **`objectives`.** Readable without horizontal scrolling?
8. **`hint`.** Does rung one leave you still thinking, or hand it over?
9. **`vi`.** Can you edit a file and get out again? Both ways out.
9b. **TAB.** Does it catch your eye when it lights up? Tap it mid-path.
9c. **TEXT.** Long-press the transcript and copy a line. Then long-press the
    input and paste it back.
10. **Suspend.** Leave mid-act, force-stop the app, come back. Is the run
    exactly where you left it?
11. **Airplane mode.** Play on. Nothing stalls.

Anything that fails 4, 6 or 10 is worth stopping for. The rest can be noted
and batched.

---

## The automated part

Not a playtest, but it catches dock regressions before a session is wasted on
one:

```bash
pnpm --filter @sigkill/terminal test:e2e
```

Playwright at a 400×780 phone viewport, driving the real input, the chip bars,
the status rows and the soft-keyboard resize path. `e2e/phone.spec.ts` is the
file; everything about *what the ship says* is a unit test instead, where it
can be read rather than screenshotted.
