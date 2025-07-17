import { AIMessage, isToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { ConfigurationSchema, ensureConfiguration } from "./configuration.js";
import { TOOLS } from "./tools.js";
import { loadChatModel } from "./utils.js";
import { transferGraph, TransferState } from "./subgraphs/transfer.subgraph.js";
import { Annotation } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import {
  typedUi,
  uiMessageReducer,
} from "@langchain/langgraph-sdk/react-ui/server";
import type ComponentMap from "./ui.js";
import { swapGraphCompiled } from "./subgraphs/swap.subgraph.js";

export const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  transferState: Annotation<TransferState | "">({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  swapState: Annotation<any | "">({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  ui: Annotation({ reducer: uiMessageReducer, default: () => [] }),
});

// Define the function that calls the model
async function callModel(
  state: typeof StateAnnotation.State,
  config: RunnableConfig
): Promise<typeof StateAnnotation.Update> {
  /** Call the LLM powering our agent. **/
  const configuration = ensureConfiguration(config);

  // Get user information from config
  const userInfo = config.configurable?.["langgraph_auth_user"];

  // Prepare system messages
  const systemMessages = [
    {
      role: "system" as const,
      content: configuration.systemPromptTemplate,
    },
  ];

  // Add user information as system message if available
  if (userInfo) {
    systemMessages.push({
      role: "system" as const,
      content:
        `User Information:\n` +
        `- ID: ${userInfo.identity}\n` +
        `- Name: ${userInfo.display_name}\n` +
        `- Email: ${userInfo.email || "N/A"}\n` +
        `- Wallet Address: ${userInfo.walletAddress || "N/A"}`,
    });
  }

  // Feel free to customize the prompt, model, and other logic!
  const model = (await loadChatModel(configuration.model)).bindTools(TOOLS);
  const response = await model.invoke([...systemMessages, ...state.messages]);
  const ui = typedUi<typeof ComponentMap>(config);

  let transferState: TransferState | "" = state.transferState;
  const lastMessage = state.messages[state.messages.length - 1];
  if (isToolMessage(lastMessage) && lastMessage.name === "get_balance") {
    ui.push(
      { name: "balances", props: JSON.parse(lastMessage.content as string) },
      { message: response }
    );
  }
  if (transferState) {
    if (transferState.phase === "completed") {
      ui.push(
        { name: "transferResult", props: transferState.result },
        { message: response }
      );
    }
    transferState = ""
  }
  // We return a list, because this will get added to the existing list
  return {
    messages: [response],
    transferState,
  };
}

async function transferFlowNode(
  state: typeof StateAnnotation.State,
  config: RunnableConfig
): Promise<typeof StateAnnotation.Update> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!isToolMessage(lastMessage) || lastMessage.name !== "initiate_transfer") {
    throw new Error("No transfer request found");
  }
  if (!state.transferState) {
    throw new Error("No transfer state found");
  }

  // const transferState: TransferState = {
  //   phase: "preparing",
  //   request: JSON.parse(lastMessage.content as string),
  // };
  const transferResponse = await transferGraph.invoke(
    {
      transferState: state.transferState,
    },
    config
  );
  // const configuration = ensureConfiguration(config);
  // Feel free to customize the prompt, model, and other logic!
  // const model = await loadChatModel(configuration.model);

  // const response = await model.invoke([
  //   {
  //     role: "system",
  //     content: configuration.systemPromptTemplate,
  //   },
  //   ...state.messages,
  //   {
  //     role: "system",
  //     content: `You need to give a summary of the transfer for user:\n\n\`\`\`json${JSON.stringify(
  //       transferResponse.transferState
  //     )}\`\`\``,
  //   },
  // ]);`
  const response = new AIMessage({
    id: uuidv4(),
    content: JSON.stringify(transferResponse.transferState),
    response_metadata: {
      hidden: true,
    },
  });

  return {
    messages: [response],
    transferState: transferResponse.transferState,
  };
}

async function swapFlowNode(
  state: typeof StateAnnotation.State,
  config: RunnableConfig
): Promise<typeof StateAnnotation.Update> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!isToolMessage(lastMessage) || lastMessage.name !== "initiate_swap") {
    throw new Error("No swap request found");
  }
  if (!state.swapState) {
    throw new Error("No swap state found");
  }
  const swapResponse = await swapGraphCompiled.invoke(
    {
      swapState: state.swapState,
    },
    config
  );
  const response = new AIMessage({
    id: uuidv4(),
    content: JSON.stringify(swapResponse.swapState),
    response_metadata: {
      hidden: true,
    },
  });
  return {
    messages: [response],
    swapState: swapResponse.swapState,
  };
}

// Define the function that determines whether to continue or not
function routeModelOutput(
  state: typeof MessagesAnnotation.State
): string | string[] {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  // check is command
  if ((lastMessage as AIMessage)?.tool_calls?.length || 0 > 0) {
    const toolCalls = (lastMessage as AIMessage).tool_calls;
    return (
      toolCalls?.map((toolCall) => {
        if (toolCall.name === "transfer") {
          return "prepareTransfer";
        }
        if (toolCall.name === "swap_tokens") {
          return "tools";
        }
        return "tools";
      }) || "tools"
    );
  }
  // Otherwise end the graph.
  else {
    return END;
  }
}

function routeAfterTools(
  state: typeof MessagesAnnotation.State
): string | string[] {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  if (isToolMessage(lastMessage) && lastMessage.name === "initiate_transfer") {
    return END;
  }
  if (isToolMessage(lastMessage) && lastMessage.name === "initiate_swap") {
    return "swapFlow";
  }
  return "callModel";
}

// Define a new graph. We use the extended TransferGraphAnnotation to define state:
// https://langchain-ai.github.io/langgraphjs/concepts/low_level/#messagesannotation
const workflow = new StateGraph(StateAnnotation, ConfigurationSchema)
  // Define the main nodes
  .addNode("callModel", callModel)
  .addNode("tools", new ToolNode(TOOLS))
  .addNode("transferFlow", transferFlowNode)
  .addNode("swapFlow", swapFlowNode)
  // Set the entrypoint as `callModel`
  .addEdge(START, "callModel")
  // Main routing: callModel decides where to go based on tool calls
  .addConditionalEdges(
    "callModel",
    routeModelOutput // Routes to prepareTransfer, prepareSwap, tools, or END
  )
  .addConditionalEdges(
    "tools",
    routeAfterTools // Routes to transferFlow, swapFlow hoặc callModel based on state
  )
  .addEdge("transferFlow", "callModel")
  .addEdge("swapFlow", "callModel");

// Finally, we compile it!
// This compiles it into a graph you can invoke and deploy.
export const graph = workflow.compile({
  interruptBefore: [], // if you want to update the state before calling the tools
  interruptAfter: [], // Pause after confirmation to wait for user approval
});
