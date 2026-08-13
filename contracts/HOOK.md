# SitowiseHook — deploy notes

Written and tested, **not deployed**. 13 tests in `test/SitowiseHook.t.sol`.

## Why the address matters

Uniswap v4 reads a hook's permissions from the low 14 bits of its own address.
`SitowiseHook` implements `afterSwap` and returns a delta, so its address must
end in flags `0x44` (`AFTER_SWAP` `1<<6` | `AFTER_SWAP_RETURNS_DELTA` `1<<2`).
The constructor calls `validateFlags()`, so deploying to any other address
reverts instead of producing a hook the PoolManager silently refuses to call.

## Mined salt

Against PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` and factory
`0x389699d7C3A754d6b82EbBBa0ebE5757ccfA1dD7`:

```
salt      71430
address   0xfD474e4Ec1D7Bd84A7d1730a895C51CD005C8044
flags     68  (0x44)
```

Re-mine if either constructor argument changes, because the salt is bound to the
init code hash:

```bash
forge script script/MineHook.s.sol --sig "run(address,address)" <poolManager> <factory>
```

## Deploy

Through the canonical CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`,
which takes `salt ++ initcode` as raw calldata.

## What it does not do

It earns nothing until a pool is created that names this address as its hook. A
v4 pool fixes its hook at `initialize` and can never change it, so the hook
cannot be attached to pools that already exist. Until such a pool exists and
carries volume, node rewards are funded by Sitowise, and the site says so.

Hook revenue arrives at the factory through `fund()`, which adds to
`freeBalance` and never to `outstanding`. Value coming from swaps therefore
cannot change what any node holder is already owed.
