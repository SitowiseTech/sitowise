begin;

-- One transaction can withdraw from many nodes.
--
-- `withdrawAll` emits one Withdrawn event per node it empties, so a single
-- transaction hash legitimately appears once per node. The original unique
-- constraint was on the hash alone, which would have accepted the first event
-- of a sweep and silently rejected the rest. The history is unique per node
-- within a transaction, so that is what the constraint should say.

alter table withdrawals drop constraint if exists withdrawals_tx_hash_key;

create unique index if not exists withdrawals_tx_node_idx
  on withdrawals (tx_hash, node_chain_id);

commit;
