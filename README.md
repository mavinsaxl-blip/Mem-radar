# MEME RADAR v0.3 — early-launch radar + paper trading

Mobile-responsive multi-chain research dashboard for Solana, Base and BNB Chain. No wallet connection, private keys or live order execution.

## What's new in v0.3
- **Early-launch radar:** checks GeckoTerminal public `new_pools` endpoints for Solana/Base/BNB Chain and intersects DEX Screener latest token profiles/boosts with indexed token-pair snapshots.
- **Runner-watch scoring:** transparent heuristic from pool age, reported liquidity, 5-minute buys/sells, volume, and price change. Candidate rows include reasons and risk warnings.
- **Auto refresh:** early-launch scan refreshes every 45 seconds; manual scan is available.
- **Chain filter and CA copy:** filter the live candidate list by chain and copy a token address.
- **No fake early candidates:** when the early-launch provider is unavailable, that panel says unavailable and does not insert demo candidates.
- Keeps the v0.2 market radar, preliminary token risk scanner, basic wallet RPC checks, optional X search, and browser-local paper positions.

## Run locally
Requirements: Node.js 18+ (Node 20+ recommended) and internet access.

```bash
unzip meme-radar-v0.3.zip
cd meme-radar
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. For a hosted deployment, set the start command to `npm start` and use the hosting service's `PORT`.

## Providers (free-first)
- **GeckoTerminal public API:** latest new-pool discovery snapshots; may rate-limit or omit pools.
- **DEX Screener public API:** latest token profiles/boosts, pair lookup and search.
- **Public RPC defaults:** Solana, Base and BNB Chain for preliminary checks. For better reliability, set `SOLANA_RPC_URL`, `BASE_RPC_URL`, and `BSC_RPC_URL` using provider free tiers.
- **Optional X API:** set `X_BEARER_TOKEN` as a server environment variable. X API access may require a paid or eligible tier; no X posts are fabricated when unavailable.

## Live versus demo
- **Early-launch panel:** LIVE only when at least one discovery provider responds. Candidate data are provider snapshots, not a complete all-pairs websocket feed. If provider calls fail, the panel shows UNAVAILABLE and no demo rows.
- **Market radar:** may show clearly labelled demo examples if its market feed fails. Demo rows are not tradeable and paper buys are blocked unless a live row has a current USD price.
- **Risk scanner / wallet checks:** live only when the corresponding DEX/RPC call succeeds; missing data is not a safety signal.
- **Paper trading:** simulated only, stored in the current browser's localStorage. No order is ever sent to a blockchain.

## Score interpretation
Runner-watch scores are ranking heuristics, not probabilities, financial advice, or a guarantee that a token will rise. Boosts can be paid promotion. Low liquidity, very new pools, high sell pressure, and extreme volume/liquidity ratios can indicate risk. Always run the risk scanner before a paper entry and test across many launches before trusting the scoring.

## Not implemented / limitations
This is not an audit or production-grade trading bot. It does not yet provide a complete all-new-pairs stream, full holder distributions, robust deployer-wallet clustering, smart-money performance labels, decoded historical swap P&L across all chains, reliable sell simulation/honeypot detection, or liquidity-lock verification. The Solana mint/freeze parser only applies to standard SPL mint accounts. EVM `owner()` calls are contract-specific. Public providers may be delayed, incomplete, or rate-limited.

## Safety
- Never enter seed phrases or private keys.
- Do not paste secrets into browser fields.
- Real-money execution is not included.
- Independently verify chain and token address before relying on market or risk information.
