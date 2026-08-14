-- Migration 006: remove the last piece of the node_balances era.
--
-- Migration 002 dropped `node_balances` and the trigger that guarded its
-- monotonicity, but MISSED the one that populated it: `nodes_create_balance`
-- fires after every insert into `nodes` and calls `create_balance_row()`, which
-- inserts into a table that no longer exists.
--
-- The damage was invisible until the first real sale. The mint succeeded on
-- chain (node #1 exists and its payment ref is consumed), and then the ledger
-- write threw `relation "node_balances" does not exist`, so the payment sat at
-- `failed` while the buyer's node was live but unregistered.
--
-- Nothing replaces it: the contract owns balances now, and node_view derives
-- the ledger figures from recorded history.

begin;

drop trigger if exists nodes_create_balance on nodes;
drop function if exists create_balance_row();

commit;
