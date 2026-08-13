# Sitowise contracts

Foundry workspace for the single contract Sitowise deploys to **Robinhood Chain, chain id 4663**.

- `src/SitowiseFactory.sol` records nodes and holds their balances on chain.

There is no voucher contract, no signer key and no Uniswap hook in this repo. Balances live in
the factory and owners withdraw them directly. An earlier design settled off-chain balances with
EIP-712 vouchers to save gas; gas on this chain is around 0.03 gwei, so that complexity bought
nothing and was removed.

## SitowiseFactory

**Payment happens outside the contract.** A buyer sends a plain transfer to the payments wallet.
A watcher sees it and the relayer calls `mintFor(to, paymentRef)`, paying the gas. `paymentRef`
is the payment transaction hash; it is emitted in `NodeMinted` and recorded in `paymentRefUsed`,
so one payment can back exactly one node and the sale can be checked in the explorer.

**Credits put real ETH on node balances.** The distributor calls `creditBatch(ids, amounts)` as a
payable call where `msg.value` must equal the sum of `amounts`. A balance can never exist without
the ETH behind it.

**Owners withdraw themselves.** `withdraw(id, to)` and `withdrawAll(to)` send from the contract
to any address the owner names. No server, no signature, no approval step. Pausing the contract
blocks new mints and never blocks a withdrawal.

### The guarantee

`outstanding` is the sum of every node balance. `rescue` can only ever move
`address(this).balance - outstanding`, so the contract owner cannot reach holder money under any
sequence of calls. This is enforced by a fuzz invariant, and the invariant is verified by
mutation: changing `rescue`'s bound to the full balance makes the suite fail.

### Roles

| Role | Set by | Can do |
|---|---|---|
| `owner` | deployer | change roles, pause, `setMaxPerWallet`, `rescue` free funds |
| `relayer` | constructor | `mintFor` only |
| `distributor` | constructor | `creditBatch` only |

Ownership transfer is two-step: `transferOwnership` records a `pendingOwner`, and the new owner
must call `acceptOwnership`. A typo cannot brick the admin surface.

`maxPerWallet` starts at 25 and cannot be raised above `MAX_PER_WALLET_CEILING` (100), because
`withdrawAll` loops over every node a wallet owns and an unbounded cap could push that sweep past
the block gas limit. Per-node `withdraw` always works regardless.

## Build and test

Dependencies are not committed. Install them once after cloning:

```sh
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
```

Then:

```sh
forge build
forge test
forge test --match-test invariant -vvv
forge fmt
```

## Deploy

Run from the **deployer key (wallet 1)**. That key becomes `owner`, so keep it cold and off the
server. The script refuses to run if the relayer or distributor equals the deployer, which would
put the owner key online.

```sh
RELAYER_ADDRESS=<wallet 3> \
DISTRIBUTOR_ADDRESS=<wallet 4> \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --private-key <deployer key> \
  --broadcast
```

## Verify on Blockscout

Needed for the Read Contract tab to work.

```sh
forge verify-contract <deployed address> src/SitowiseFactory.sol:SitowiseFactory \
  --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api \
  --compiler-version v0.8.26 \
  --num-of-optimizations 200 \
  --constructor-args $(cast abi-encode "constructor(address,address)" <wallet 3> <wallet 4>)
```

Constructor arguments must match the deploy exactly or verification fails.

## Gas

Measured on chain at 0.0297 gwei, ETH around $2450.

| Action | Gas | Cost | Paid by |
|---|---|---|---|
| deploy | ~1.44M | $0.10 | you, once |
| `mintFor` | ~130k | $0.009 | you (relayer) |
| `creditBatch` | ~30k + ~8k per node | see below | you (distributor) |
| `withdraw` | ~55k | $0.004 | the node owner |
| `withdrawAll`, 25 nodes | ~700k | $0.05 | the node owner |

At a 60 second tick the distributor spends roughly $3 a day on batch overhead plus $0.42 a day
per node, which is small next to the payouts themselves.

## Wallets

Four, deliberately separate:

1. **Deployer / owner** — cold, never on the server. Needs gas only for the deploy and rare
   admin calls.
2. **Payments** — receives node payments. The server only watches the address; the key can stay
   entirely offline.
3. **Relayer** — server key. Holds gas and nothing else. If it leaks, the cost is gas plus
   unauthorised mints, not funds.
4. **Distributor** — server key. Holds the money used for payouts, so keep only a few days of
   runway on it.
