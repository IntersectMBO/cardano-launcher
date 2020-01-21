# cardano-launcher Shelley

`cardano-launcher` is a Node.js module for starting
[cardano-wallet](https://github.com/input-output-hk/cardano-wallet)
and the Shelley
[cardano-node](https://github.com/input-output-hk/cardano-node).

Its primary user is
[Daedalus](https://github.com/input-output-hk/daedalus); however it
could be used by any Javascript application.


## Block diagram

```
Daedalus
 |   |
 |   |
 |   |
 |  cardano-launcher
 |          |
 |   +------+---------------+
 |   |                     |
cardano-wallet -->  cardano-node
```


## Local Development

### `npm start`

Runs the project in development/watch mode.

### `npm run build`

Bundles the package to the `dist` folder.

### `npm test`

Runs the test watcher (Jest) in an interactive mode.
By default, runs tests related to files changed since the last commit.

### `npm run typedoc`

Generates API documentation to the `docs` folder.
