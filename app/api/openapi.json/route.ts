/**
 * GET /api/openapi.json
 *
 * The public API as a machine-readable document, so it can be loaded into a
 * client generator, an HTTP client or a schema validator instead of being
 * transcribed by hand out of the docs pages.
 *
 * Only the public, unauthenticated surface is described. The admin and cron
 * routes are deliberately absent: documenting a guarded endpoint in a public
 * document advertises it without making it any more usable, and the one thing
 * we can control about them is how loudly they announce themselves.
 *
 * The document is written out literally rather than generated from the route
 * handlers. Generation would drift silently the moment a handler changed shape,
 * and a spec that is quietly wrong is worse than one that is obviously stale.
 */

import {checkLimit, jsonOk, mergeHeaders, publicCache, toResponse} from "@/lib/api";
import {siteUrl} from "@/lib/site";

const WEI = {
  type: "string",
  pattern: "^\\d+$",
  description: "A whole number of wei as a decimal string. Never a float.",
} as const;

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "openapi", {limit: 60});
  if (limit.blocked) return limit.blocked;

  try {
    const spec = {
      openapi: "3.1.0",
      info: {
        title: "Sitowise API",
        version: "1.0.0",
        description:
          "Read-only access to node sales on Robinhood Chain. Every money figure is a " +
          "decimal string of wei, because a balance that passes through a float stops " +
          "adding up. Nothing here needs a key.",
      },
      servers: [{url: siteUrl()}],
      paths: {
        "/api/stats": {
          get: {
            summary: "Protocol totals",
            responses: {
              "200": {
                description: "Counters behind the landing page.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        totalNodes: {type: "integer"},
                        operators: {type: "integer", description: "Distinct wallets holding a node."},
                        totalDistributedWei: WEI,
                        distributions24hWei: WEI,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/api/cover": {
          get: {
            summary: "Whether node balances are backed",
            description:
              "Read from the chain rather than from our database, and both figures come " +
              "from the same block. Answers 503 rather than serving a stale 'covered' " +
              "when the chain cannot be read.",
            responses: {
              "200": {
                description: "What the contract owes and what it holds.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        contract: {type: "string"},
                        balanceWei: WEI,
                        outstandingWei: WEI,
                        covered: {type: "boolean"},
                        paused: {
                          type: "boolean",
                          description: "Minting only. Pausing cannot block a withdrawal.",
                        },
                      },
                    },
                  },
                },
              },
              "503": {description: "The chain could not be read."},
            },
          },
        },
        "/api/tiers": {
          get: {
            summary: "Node tiers",
            description:
              "Prices, allowances and holding thresholds. `enforcedBy` says which rules " +
              "the contract applies and which we do; only the total per wallet is on chain.",
            responses: {
              "200": {
                description: "Every tier, whether on sale or not.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        tiers: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: {type: "string"},
                              label: {type: "string"},
                              priceWei: WEI,
                              maxPerWallet: {type: "integer"},
                              holdingWei: WEI,
                              holdingToken: {type: ["string", "null"]},
                              payoutBps: {
                                type: "integer",
                                description: "Accrual against the base range. 10000 is base.",
                              },
                              onSale: {type: "boolean"},
                              enforcedBy: {type: "object"},
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/api/nodes/{address}": {
          get: {
            summary: "Every node a wallet holds",
            parameters: [
              {
                name: "address",
                in: "path",
                required: true,
                schema: {type: "string", pattern: "^0x[a-fA-F0-9]{40}$"},
              },
            ],
            responses: {
              "200": {
                description: "Nodes, oldest first.",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: {type: "integer", description: "Use as :id on /api/node/:id."},
                          chainNodeId: {type: "string"},
                          tier: {type: "string"},
                          balanceWei: WEI,
                          cumulativeWei: WEI,
                          withdrawnWei: WEI,
                          mintTx: {type: "string"},
                          status: {type: "string"},
                          createdAt: {type: ["string", "null"], format: "date-time"},
                        },
                      },
                    },
                  },
                },
              },
              "400": {description: "Not an address."},
            },
          },
        },
        "/api/node/{id}": {
          get: {
            summary: "One node, with its credits and withdrawals",
            parameters: [{name: "id", in: "path", required: true, schema: {type: "integer"}}],
            responses: {
              "200": {description: "The node in full."},
              "404": {description: "No such node."},
            },
          },
        },
        "/api/distributions": {
          get: {
            summary: "Recent distribution rounds",
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: {type: "integer", minimum: 1, maximum: 100, default: 50},
              },
            ],
            responses: {"200": {description: "Rounds, newest first."}},
          },
        },
        "/api/payments/claim": {
          post: {
            summary: "Report a payment you just made",
            description:
              "Tells the server about a payment instead of waiting for discovery to find it. " +
              "The hash is only a pointer: every fact is re-read from the chain, and the node " +
              "is always minted to the address the ETH came from, never to the caller. " +
              "Idempotent.",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["txHash"],
                    properties: {
                      txHash: {type: "string", pattern: "^0x[0-9a-fA-F]{64}$"},
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "What the payment is, and the node if it has one.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        status: {
                          type: "string",
                          enum: ["seen", "minting", "minted", "failed", "manual_review", "refunded"],
                        },
                        tier: {type: ["string", "null"]},
                        nodeChainId: {type: ["string", "null"]},
                        from: {type: ["string", "null"]},
                        amountWei: {type: ["string", "null"]},
                        reason: {
                          type: ["string", "null"],
                          description: "Why it is held, when it is held.",
                        },
                        known: {
                          type: "boolean",
                          description: "False when this call is what recorded it.",
                        },
                      },
                    },
                  },
                },
              },
              "400": {description: "Not a transaction hash."},
              "409": {
                description:
                  "Not usable as a payment yet or at all. A hash the RPC has not caught up to " +
                  "is worth retrying; one addressed elsewhere is not.",
              },
            },
          },
        },
        "/api/price": {
          get: {
            summary: "ETH price in USD",
            description: "null when no quote was available, never a made-up number.",
            responses: {"200": {description: "{ usd: number | null }"}},
          },
        },
      },
      components: {
        responses: {
          Error: {
            description:
              "Every failure is the same shape: { error: string }. The message is meant " +
              "to be shown to a person.",
            content: {
              "application/json": {
                schema: {type: "object", properties: {error: {type: "string"}}},
              },
            },
          },
        },
      },
    };

    return jsonOk(spec, mergeHeaders(limit.headers, publicCache(300)));
  } catch (err) {
    return toResponse(err, "openapi", limit.headers);
  }
}
