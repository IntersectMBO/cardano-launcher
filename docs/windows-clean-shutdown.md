# Windows - clean shutdown

On Windows, the only way to stop a non-gui program is by using [TerminateProcess](https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess).

> ### Remarks
>
> The `TerminateProcess` function is used to unconditionally cause a process to exit.
> ... This function stops execution of all threads within the process and requests cancellation of all pending I/O.
> ... A process cannot prevent itself from being terminated.

The problem is that if `cardano-wallet` or `cardano-node` is stopped
like this, it will be unable to nicely close its database, flush logs,
or end any child processes. The effect is basically the same as `kill -9`
on POSIX.

## Solution

The only way to work around this is by implementing a method of
signalling to the child process that it should exit.

In the previous codebase, this was achieved (indirectly) with
`NodeIPC`. The `NodeIPC` thread in the child process reads a named
pipe, waiting for messages. If the parent process end of the named
pipe is close, the read function returns an error, and the program
shuts down.

We can achieve the same behaviour in the child process, without
`NodeIPC`, by continuously reading standard input. If there is an
error reading standard input, such as "end of file" or "broken pipe",
then the child process knows that it's time to exit. The parent
process can trigger this condition by closing the file descriptor that
it has passed as the `stdin` of the child process.

If `stdin` can't be used for clean shutdown, then a supplementary
inherited pipe file descriptor can be used instead. In this case the
parent process will also need to provide the fd number to the child
process via command-line option or environment variable.

![Launch message sequence diagram](./launch.png)

## POSIX

On POSIX platforms, `cardano-wallet` can shutdown cleanly after being
killed with `SIGTERM`.

However, when running under `cardano-launcher`, we use identical
shutdown methods on both Windows and POSIX in an attempt to avoid
platform-specific bugs.

## Timeouts

Since the child process is requested to shut itself down, it may
defectively fail to do so. This means that open files will still be
locked, etc, and will cause problems for users.

To guarantee that the child process exits, the child process ID should
be checked after a timeout period has elapsed. If it is still running
then it should be killed with `TerminateProcess`/`SIGKILL`.

## If the `cardano-launcher` process is killed

If the `cardano-launcher` (i.e. Daedalus) process itself is killed,
then it should ensure that its own child processes are killed.

In this case `stdin` of the child process will be automatically
closed, and it will exit.

## Command-line options

This cross-platform clean shutdown method is only necessary in
situations where the code will be running on Windows as a child
process of an application. In other circumstances, the process can be
killed with [Control-C](https://docs.microsoft.com/en-us/windows/console/generateconsolectrlevent)
(Windows) or `SIGTERM` (POSIX). Therefore, an optional command-line
parameter such as `--shutdown-ipc=FD` should be used to enable the
clean shutdown handler.

## Example implementations

* [cardano-wallet](https://github.com/input-output-hk/cardano-wallet/blob/master/lib/launcher/src/Cardano/Startup.hs)
* [cardano-node](https://github.com/input-output-hk/cardano-node/blob/1.10.1/cardano-node/src/Cardano/Node/Run.hs#L318-L358)
