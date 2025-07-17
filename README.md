# Aptos Blockchain Agent

An intelligent AI agent built with [LangGraph.js](https://github.com/langchain-ai/langgraphjs) that provides seamless interaction with the [Aptos blockchain](https://aptos.dev/). This agent enables users to perform various blockchain operations through natural language conversations, including checking balances, transferring tokens, estimating gas costs, and more.

## 🚀 What it does

The Aptos Agent provides a conversational interface to interact with the Aptos blockchain through these core capabilities:

### 💰 Wallet Management
- **Balance Queries**: Check APT and custom token balances
- **Wallet Information**: View wallet address, public key, and account details
- **Multi-token Support**: Handle APT, USDC, USDT, and other Aptos-native tokens

### 🔄 Transaction Operations
- **Token Transfers**: Send APT or custom tokens to any address (via advanced subgraph workflow)
- **Gas Estimation**: Calculate transaction costs before execution
- **Transaction Tracking**: Get detailed information about transaction status and history
- **Safety Features**: Built-in confirmation prompts for secure transactions

### 🔍 Blockchain Utilities
- **Token Discovery**: Look up token contract addresses by name or symbol
- **Market Data**: Real-time token prices, market cap, volume, and supply data from CoinGecko/CoinMarketCap
- **Transaction History**: Retrieve and analyze past transactions
- **Network Support**: Works with Mainnet, Testnet, and Devnet

## 🏗️ Architecture

The agent follows a **ReAct (Reasoning + Acting) pattern** with advanced subgraph workflows for complex operations:

1. **Receives** user requests in natural language
2. **Reasons** about the required blockchain operations
3. **Acts** by calling appropriate Aptos tools or subgraphs
4. **Observes** the results and provides formatted responses
5. **Iterates** until the user's request is fully satisfied

### Core Components

- **`src/aptos_agent/graph.ts`** - Main agent logic and workflow orchestration
- **`src/aptos_agent/tools/`** - Blockchain interaction tools (7 specialized tools)
- **`src/aptos_agent/subgraphs/`** - Advanced workflows for complex operations (transfer, swap)
- **`src/aptos_agent/config/`** - Aptos network and token configurations
- **`src/aptos_agent/apis/`** - Wallet and blockchain API interfaces
- **`src/security/`** - Authentication and JWT handling

## 🛠️ Available Tools

| Tool | Description | Usage Example |
|------|-------------|---------------|
| **Balance Tool** | Get token balances for APT or custom tokens | "What's my APT balance?" |
| **Transfer Tool** | Send tokens to other addresses (via subgraph workflow) | "Send 1 APT to 0x123..." |
| **Gas Estimation** | Calculate transaction fees for various operations | "How much will this transfer cost?" |
| **Token List** | Find token information and available tokens | "What tokens are available?" |
| **Token Market Data** | Get comprehensive market data including price, volume, and supply from CoinGecko/CoinMarketCap | "Show me market data for APT" |
| **Wallet Info** | Get wallet details and account info | "Show me my wallet information" |
| **Transaction Info** | Track transaction status, details, and history by hash | "Check transaction 0xabc..." |

## 🚦 Getting Started

### Prerequisites

- Node.js 18+ and Yarn
- [LangGraph Studio](https://github.com/langchain-ai/langgraph-studio) installed

### Setup

1. **Clone and install dependencies**
```bash
git clone <repository-url>
cd aptos-agent
yarn install
```

2. **Configure environment**
```bash
cp .env.example .env
```

3. **Set required environment variables in `.env`**

```bash
# Language Model API Key (choose one)
ANTHROPIC_API_KEY=your-anthropic-key
# OR
OPENAI_API_KEY=your-openai-key

# Aptos Configuration
APTOS_NETWORK=testnet  # or mainnet, devnet
APTOS_RPC_URL=https://api.testnet.aptoslabs.com/v1  # optional

# Database (for wallet management)
MONGODB_URI=mongodb://localhost:27017/aptos-agent

# Security
JWT_SECRET=your-jwt-secret

# Optional: Token Price APIs
COINMARKETCAP_API_KEY=your-coinmarketcap-key  # Optional, for CoinMarketCap price data
```

### Model Configuration

The agent supports multiple language models:

#### Anthropic (Default)
```bash
ANTHROPIC_API_KEY=your-anthropic-key
```
Supported models: `claude-3-5-sonnet-20240620`, `claude-3-haiku-20240307`, etc.

#### OpenAI
```bash
OPENAI_API_KEY=your-openai-key
```
Supported models: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`, etc.

### Launch

4. **Open in LangGraph Studio**
```bash
langgraph studio
```

5. **Start chatting with your Aptos agent!**

Example conversations:
- "What's my APT balance?"
- "Send 0.1 APT to 0x742d35cc6078de866c46a98b55c93a83e1e86968e66e22ad5d6c5c2c5c8e2e3"
- "How much gas will it cost to transfer 5 USDC?"
- "Show me market data for APT"
- "Check transaction 0x123..."

## 🔧 Customization

### Adding New Tools

1. Create a new tool in `src/aptos_agent/tools/`
2. Implement the `StructuredTool` interface
3. Add to the tools array in `src/aptos_agent/tools.ts`

Example:
```typescript
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export class MyCustomTool extends StructuredTool {
  name = "my_custom_tool";
  description = "Description of what this tool does";
  schema = z.object({
    parameter: z.string().describe("Parameter description")
  });

  async _call(input: { parameter: string }): Promise<string> {
    // Your tool logic here
    return "Tool response";
  }
}
```

### Network Configuration

Modify `src/aptos_agent/config/aptos.config.ts`:

```typescript
export const APTOS_CONFIG = {
  network: Network.MAINNET, // Change network
  rpcUrl: "https://custom-rpc-url.com", // Custom RPC
};
```

### Adding New Tokens

Update the token registry configuration to include new tokens with their contract addresses, symbols, and metadata.

### Custom System Prompt

Modify `src/aptos_agent/prompts.ts` to customize the agent's behavior:

```typescript
export const SYSTEM_PROMPT_TEMPLATE = `
Your custom system prompt here...
Include specific instructions for your use case.
`;
```

### Creating Advanced Workflows

For complex multi-step operations, consider creating subgraphs in `src/aptos_agent/subgraphs/`:

```typescript
// Example: Custom swap subgraph
export async function myCustomWorkflow(
  state: typeof MessagesAnnotation.State,
  config: RunnableConfig
): Promise<typeof MessagesAnnotation.State> {
  // Implement your multi-step workflow
}
```

## 🧪 Development

### Running Tests

```bash
# Unit tests
yarn test

# Integration tests  
yarn test:int

# Linting
yarn lint

# Build
yarn build

# Development mode
yarn dev
```

### Project Structure

```
src/
├── aptos_agent/
│   ├── apis/           # Blockchain API interfaces
│   ├── config/         # Network and token configurations  
│   ├── subgraphs/      # Advanced multi-step workflows
│   ├── tools/          # Blockchain interaction tools
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Helper functions
│   ├── graph.ts        # Main agent workflow
│   ├── tools.ts        # Tool exports
│   └── prompts.ts      # System prompts
├── security/           # Authentication & JWT
```

### Authentication Flow

The agent uses JWT-based authentication to associate users with their wallets:

1. User authenticates and receives JWT token
2. JWT contains user ID that maps to wallet information
3. All blockchain operations are performed on behalf of the authenticated user
4. Wallet information is securely stored and retrieved via `walletApi`

### Advanced Transfer Workflow

Transfers are handled through a sophisticated subgraph workflow that includes:

1. **Preparation Phase**: Balance validation, gas estimation, and transaction building
2. **Confirmation Phase**: Interactive user confirmation with detailed transaction preview
3. **Execution Phase**: Transaction signing, submission, and confirmation tracking

This ensures maximum security and user control over transactions.

## 🔒 Security Features

- **Transaction Confirmation**: All transactions require explicit user approval through interactive workflows
- **Gas Estimation**: Show costs before execution with detailed breakdowns
- **Input Validation**: All inputs are validated using Zod schemas
- **User Authentication**: JWT-based user identification and wallet association
- **Network Isolation**: Configurable network environments
- **Balance Verification**: Automatic balance checks before transaction execution
- **Interactive Approvals**: User-friendly confirmation dialogs with transaction details

## 🚀 Key Features

- **Real-time Market Data**: Integration with CoinGecko and CoinMarketCap APIs
- **Multi-token Support**: Support for both legacy coin standard and new fungible asset standard
- **Advanced Gas Management**: Intelligent gas estimation and optimization
- **Explorer Integration**: Direct links to Aptos Explorer for transactions and tokens
- **Comprehensive Error Handling**: Detailed error messages and recovery suggestions
- **Flexible Architecture**: Easy to extend with new tools and workflows

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make changes and add tests
4. Run tests: `yarn test`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Resources

- [Aptos Developer Documentation](https://aptos.dev/)
- [Aptos TypeScript SDK](https://github.com/aptos-labs/aptos-ts-sdk)
- [LangGraph.js Documentation](https://langchain-ai.github.io/langgraphjs/)
- [LangGraph Studio](https://github.com/langchain-ai/langgraph-studio)
