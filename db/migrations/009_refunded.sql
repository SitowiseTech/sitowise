-- A payment that was received and paid back, and must never become a node.
--
-- The status set had no way to say this. The case that forced it: a wallet at
-- the per-wallet cap sent four more payments, the contract could not mint
-- against them, and the money was returned off chain. Nothing in the ledger
-- recorded that, so a later backfill over those blocks, or a raised cap plus a
-- requeue, would have handed out four nodes that were already refunded.
--
-- 'refunded' is terminal. No pass claims it: claimForMinting takes 'seen' and
-- 'failed' only, and requeuePayment refuses anything outside
-- ('manual_review','failed').

alter table payments drop constraint if exists payments_status_check;

alter table payments add constraint payments_status_check
  check (status in ('seen','minting','minted','failed','manual_review','refunded'));
