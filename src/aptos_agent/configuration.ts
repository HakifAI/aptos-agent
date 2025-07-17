/**
 * Define the configurable parameters for the agent.
 */
import { Annotation } from "@langchain/langgraph";
import { SYSTEM_PROMPT_TEMPLATE } from "./prompts.js";
import { RunnableConfig } from "@langchain/core/runnables";
import { format } from "date-fns";

export const ConfigurationSchema = Annotation.Root({
  /**
   * The system prompt to be used by the agent.
   */
  systemPromptTemplate: Annotation<string>,

  /**
   * The name of the language model to be used by the agent.
   */
  model: Annotation<string>,
});

export function ensureConfiguration(
  config: RunnableConfig
): typeof ConfigurationSchema.State {
  /**
   * Ensure the defaults are populated.
   */
  const configurable = config.configurable ?? {};
  let systemPromptTemplate =
    configurable.systemPromptTemplate ?? SYSTEM_PROMPT_TEMPLATE;
  const intruction = `
**Instructions:**
- Answer in the user's language.
- DO NOT show token image/logo in the response.
- You are a helpful AI assistant that can help with Aptos blockchain transactions.
- Don't make up any information, if you don't know the answer, use the tools to get the information or say you don't know.
- If you not sure about token address, use get_token_list tool to get the token address first. If not found, ask user to provide the token address.
`;

  systemPromptTemplate =
    systemPromptTemplate.replace(
      "{system_time}",
      format(new Date(), "EEEE, MMM d, yyyy hh:mm a zzz")
    ) + intruction;

  return {
    ...config,
    systemPromptTemplate,
    model:
      configurable.model ??
      (process.env.DEFAULT_MODEL as string) ??
      "gpt-4o-mini",
  };
}
