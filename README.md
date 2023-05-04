# PIPR - Prepare Input to Prompt and Resolve

PIPR is a library that helps you generate conversational AI prompts with ease. Pipr can be used to generate natural language responses to specific prompts by calling the OpenAI GPT-3 API. Pipr is designed to give better DX on writing prompt functions

## Installation

Install `pipr` using npm or yarn:

```bash
npm install @pipr/core
```

```bash
yarn add @pipr/core
```

## Usage

Here is an example usage of Pipr:

```tsx
const getAge = createPipr()
  .input(
    z.object({
      name: z.string(),
      age: z.number(),
    })
  )
  .prepare(({ age }) => {
    return {
      ...input,
      age: age + 1,
    };
  })
  .prompt({
    system: 'You will remember everythin I say',
    user: ({ name }) => `The age of ${input.name} is:`,
  })
  .history(({ input }) => [
    {
      user: `John is ${input.age - 1} years old`,
      assistant: 'Nice to meet you, John!',
    },
    { user: `Alice is ${input.age + 1} years.`, assistant: 'Hello Alice!' },
  ])
  .resolve(ctx => {
    return ctx.blocks[0].content;
  });

const age = await getAge({ name: 'Alice', age: 44 });
console.log(age); // 46
```

## `.input`

The `.input` method sets the schema for the input data. The schema should be defined using the `zod` library. The method returns a prompter instance that can be used to set the prompt configuration.

```tsx
pipr.input(z.object({ name: z.string(), age: z.number() }));
```

## `.prepare`

The `.prepare` method sets a preparer function that will be called before the prompt is generated. The preparer function takes the raw input data as a parameter and returns a prepared input data that will be used to generate the prompt. This method can be used to fetch async data needed to add to the prompt.

```tsx
pipr.input(schema).prepare(async rawInput => {
  return {
    name: rawInput.name.toUpperCase(),
    age: rawInput.age * 2,
  };
});
```

## `.prompt`

The `.prompt` method sets the prompt configuration. The configuration is an object with `user` and `system` properties that represent the user's input and the AI's response, respectively. The properties can be set to a string or a function that returns a string.

```tsx
pipr.input(schema).prompt({
  user: 'What is your name?',
  system: "You're best greater",
});
```

## `.history`

The `.history` method sets a function that will be called to generate a history for the prompt. The function takes a `promptify` and `input` as a parameter and should return an array of prompt examples. Prompt examples are objects with a `user` and an `assistant` property that represent the user's input and the AI's response, respectively.

```tsx
pipr
  .input(schema)
  .prompt({
    system: 'Hi there! What can I do for you today?',
    user: ({ name }) => `My name is ${name}. What is your name?`,
  })
  .history(async ({ promptify, prepare }) => {
    const prepared = await prepare({
      name: 'John',
      age: 30,
    });

    return [
      {
        user: promptify(prepared).user, // My name is John. What is your name?
        assistant: 'Hello John! My name is ChatGPT. How can I help you today?',
      },
    ];
  });
```

## `.resolve`

The `.resolve` method is called after the request is sent to the Open AI API. It takes the OpenAI API responded and resolves the value to return.
