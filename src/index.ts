import { z } from 'zod';

export interface AIMessage {
  content: string;
  role: 'user' | 'system' | 'assistant';
}

interface ErrorOutput {
  error: {
    message: string;
    code: string;
    type: string;
    param: string;
  };
}

export interface OpenAIError extends Error {
  code: string;
  type: string;
  param: string;
}

type Output = SuccessOutput | ErrorOutput;

interface SuccessOutput {
  id: string;
  object: string;
  created: number;
  model: string;
  usage: Usage;
  choices: Choice[];
}

interface Choice {
  message: AIMessage;
  finish_reason: string;
  index: number;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OutputWithBlocks extends SuccessOutput {
  blocks: ChatGPTBlock[];
}

export interface ChatGPTBlock {
  type: string;
  content: string;
}

type Preparer<Input, T> = (input: Input) => T;

type Prompter<Input, PreparedInput = unknown> = {
  prompt: (
    config: PromptConfig<
      PreparedInput extends undefined ? Input : PreparedInput
    >
  ) => BuildPrompt<Input, PreparedInput>;
};

type PrompterAddPrepare<Input> = Prompter<Input> & {
  prepare: <T>(fn: Preparer<Input, T>) => Prompter<Input, Awaited<T>>;
};

type PrompterAddInput = PrompterAddPrepare<unknown> & {
  input: <Schema extends z.ZodSchema>(
    z: Schema
  ) => PrompterAddPrepare<z.infer<Schema>>;
};

interface Prompt<Input, PreparedInput = unknown> {
  resolve<T>(
    fn: (
      ctx: PreparedInput extends undefined
        ? ResolvedPromptCtx<Input>
        : ResolvedPromptCtx<PreparedInput>
    ) => T
  ): (input: Input) => T;
}

type ResolvedPromptCtx<Input> = {
  data: OutputWithBlocks;
  blocks: OutputWithBlocks['blocks'];
} & PromptConfig<Input> & { input: Input };

export type PromptHistory = { user: string; assistant: string };

type PromptBuildCtx<Input, PreparedInput = unknown> = PromptConfig<Input> & {
  promptify: (
    input: PreparedInput extends undefined ? Input : PreparedInput
  ) => { user: string; system: string };
} & {
  prepare: PreparedInput extends undefined
    ? undefined
    : Preparer<Input, PreparedInput>;
};

type GetHistoryItem<Input, PreparedInput = unknown> = (
  config: PromptBuildCtx<Input, PreparedInput>
) => PromptHistory[] | Promise<PromptHistory[]>;

type PromptAddHistoryItem<
  Input,
  PreparedInput = unknown,
  Return = Prompt<Input, PreparedInput>
> = Prompt<Input, PreparedInput> & {
  historyitem: (fn: GetHistoryItem<Input, PreparedInput>) => Return;
};
type PromptAddCorrector<
  Input,
  PreparedInput = unknown,
  Return = Prompt<Input, PreparedInput>
> = Prompt<Input, PreparedInput> & {
  correct: (fn: Corrector<Input, PreparedInput>) => Return;
};

type BuildPrompt<Input, PreparedInput = unknown> = Prompt<
  Input,
  PreparedInput
> &
  PromptAddCorrector<
    Input,
    PreparedInput,
    PromptAddHistoryItem<Input, PreparedInput>
  > &
  PromptAddHistoryItem<
    Input,
    PreparedInput,
    PromptAddCorrector<Input, PreparedInput>
  >;

interface PromptConfig<Input> {
  user: string | ((input: Input) => string);
  system: string | ((input: Input) => string);
}

function callOrReturn(fn: any, input: any) {
  return typeof fn === 'function' ? fn(input) : fn;
}

type Options = AIConfig & {
  /**
   * If true, the AI will generate new historyitem before generating the response.
   */
  fresh?: boolean;
};

type AIConfig = {
  model?: string;
  messages: AIMessage[];
  temperature?: number;
};

function normalizeCodeBlockType(blockType?: string): string {
  if (!blockType) {
    return 'code';
  }

  if (blockType.toLowerCase() === 'sql') {
    return 'sql';
  }

  return blockType;
}

function transformOutput(message: string) {
  const trimmed = message.trim();
  const blocks = [];
  let lastBlockIndex = 0;

  trimmed.replace(
    /```([^\n]+)?\n([\s\S]*?)\n```/g,
    (
      rawValue: string,
      blockType: string,
      blockContent: string,
      index: number
    ) => {
      if (index !== lastBlockIndex) {
        const content = trimmed.substring(lastBlockIndex, index);
        blocks.push({
          type: 'text',
          content: content.trim(),
        });

        lastBlockIndex += content.length;
      }

      blocks.push({
        type: normalizeCodeBlockType(blockType),
        content: blockContent,
      });
      lastBlockIndex += rawValue.length;

      return '';
    }
  );

  if (lastBlockIndex !== trimmed.length - 1) {
    blocks.push({
      type: 'text',
      content: trimmed.substring(lastBlockIndex).trim(),
    });
  }

  return blocks;
}

export const createOpenAIFetch = (apiKey: string) => ({
  model = 'gpt-3.5-turbo',
  messages,
  temperature = 0.2,
}: AIConfig) => {
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  })
    .then(res => (res.json() as any) as Output)
    .then(json => {
      if ('error' in json) {
        const error = new Error(
          `Invalid response from OpenAI: ${json.error?.message}`
        );

        Object.assign(error, json.error);

        throw error;
      }

      const blocks: ChatGPTBlock[] = [];
      json.choices.forEach(choice => {
        blocks.push(...transformOutput(choice.message.content));
      });

      return {
        ...json,
        blocks,
      };
    });
};

export type PiprConfig = {
  apiKey: string;
  events?: {
    resolve?: (json: OutputWithBlocks) => void;
  };
};

export type Corrector<Input, PreparedInput = unknown> = (
  error: OpenAIError,
  messages: AIMessage[],
  ctx: PromptBuildCtx<Input, PreparedInput>
) => Promise<AIMessage[]> | AIMessage[];

export function createPipr({ apiKey, events }: PiprConfig) {
  let schema: z.ZodSchema | undefined = undefined;
  let getHistoryItem: GetHistoryItem<unknown, unknown> | undefined = undefined;
  let historyitem: PromptHistory[] | undefined;
  let preparer: Preparer<unknown, unknown> | undefined;
  let corrector: Corrector<unknown, unknown> | undefined;
  const ai = createOpenAIFetch(apiKey);

  const base: Prompter<unknown> = {
    prompt: (config: PromptConfig<unknown>) => {
      const promptify = (input: unknown) => {
        return {
          system: callOrReturn(config.system, input),
          user: callOrReturn(config.user, input),
        };
      };
      const prompt = {
        resolve: (fn: any) => {
          // create function
          return async (rawInput: any, options?: Options) => {
            const unpreparedInput = schema ? schema.parse(rawInput) : rawInput;

            const buildCtx = {
              ...config,
              promptify,
              prepare: preparer as Preparer<unknown, unknown>,
            } as PromptBuildCtx<unknown, unknown>;

            if (getHistoryItem && (!historyitem || options?.fresh)) {
              historyitem = await getHistoryItem(buildCtx);
            }

            const input = preparer
              ? await preparer(unpreparedInput)
              : unpreparedInput;

            const { user, system } = promptify(input);

            const historyMessages = historyitem
              ? historyitem
                  .map(
                    history =>
                      [
                        {
                          role: 'user',
                          content: history.user,
                        },
                        {
                          role: 'assistant',
                          content: history.assistant,
                        },
                      ] as AIMessage[]
                  )
                  .flat()
              : [];

            let data: OutputWithBlocks | undefined = undefined;

            const messages: AIMessage[] = [
              {
                role: 'system',
                content: system,
              },
              ...historyMessages,
              {
                role: 'user',
                content: user,
              },
            ];

            try {
              data = await ai({
                ...options,
                messages,
              });
            } catch (error) {
              if (corrector) {
                const correctedMessages = await corrector(
                  error as OpenAIError,
                  messages,
                  buildCtx
                );

                data = await ai({
                  ...options,
                  messages: correctedMessages,
                });
              } else {
                throw error;
              }
            }

            events?.resolve?.(data);

            return fn({ ...config, data, blocks: data.blocks, input });
          };
        },
      } as Prompt<unknown>;

      const build: BuildPrompt<unknown> = {
        ...prompt,
        historyitem(fn) {
          getHistoryItem = fn;
          return build;
        },
        correct(fn) {
          corrector = fn;
          return build;
        },
      };

      return build;
    },
  };

  const prepare = <T>(fn: Preparer<unknown, T>) => {
    preparer = fn;
    return base as Prompter<unknown, unknown>;
  };

  return {
    ...base,
    prepare,
    input: <T extends z.Schema>(nextSchema: T) => {
      schema = nextSchema;
      return {
        ...base,
        prepare,
      } as PrompterAddPrepare<T>;
    },
  } as PrompterAddInput;
}
