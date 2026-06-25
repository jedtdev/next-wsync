import { storage } from "next-wsync";

export type ChatMessage = {
  type: "message";
  id: string;
  username: string;
  text: string;
  at: string;
};

export const historyStore = storage("history", {
  store: { messages: [] as ChatMessage[] },
  methods: (store) => ({
    push(msg: ChatMessage) {
      store.messages.push(msg);
      if (store.messages.length > 100) store.messages.shift();
    },
    getAll(): ChatMessage[] {
      return store.messages;
    },
  }),
});
