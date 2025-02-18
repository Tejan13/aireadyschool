"use client";

import { useChat } from "ai/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRef, useState, useCallback, useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { ChatArea } from "./components/chat-area";
import { useChatThread } from "@/app/hooks/useChatThread";
import { ThreadList } from "./components/thread-list";
import { useRouter } from "next/navigation";
import { Message, CreateMessage } from "ai";
import { ChatMessage, ToolCall, ToolState } from "@/types/chat";

interface UserMessage extends ChatMessage {
  role: "user";
  content: string;
  toolCalls?: ToolCall[];
}

// Add TypeScript interface for thread data
interface ThreadData {
  thread: {
    id: string;
    title: string;
    // ... add other thread properties as needed
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    toolCalls?: Array<{
      id: string;
      tool: string;
      parameters: any;
      result?: any;
      state?: string;
    }>;
  }>;
}

export default function Page() {
  const router = useRouter();
  const { setOpen } = useSidebar();
  const {
    threadId,
    threads,
    createThread,
    saveMessage,
    loadThread,
    deleteThread,
    startNewThread,
    currentMessages,
    setCurrentMessages, // Add this line
  } = useChatThread();

  // Load thread when URL changes or threadId changes
  useEffect(() => {
    setOpen(false);
    const searchParams = new URLSearchParams(window.location.search);
    const threadParam = searchParams.get("thread");

    if (threadParam) {
      handleThreadSelect(threadParam);
    }
  }, [setOpen]); // Remove threadId dependency to prevent loops

  // Create a ref to store the chat instance
  const chatRef = useRef<any>(null);

  // Initialize chat
  const chat = useChat({
    api: "/api/gen-chat",
    id: threadId,
    initialMessages: currentMessages.map((msg) => ({
      id: msg.id || String(Date.now()), // Ensure id is always present
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    })),
    body: { id: threadId },
    onFinish: useCallback(
      async (message: Message) => {
        const messageToSave: ChatMessage = {
          id: String(Date.now()),
          role: message.role as ChatMessage["role"],
          content: message.content,
          createdAt: new Date(),
          toolCalls: (message as any).toolCalls?.map((call: any) => ({
            id: call.id || String(Date.now()),
            tool: call.tool || call.function?.name,
            parameters: call.parameters || call.function?.arguments,
            result: call.result,
            state: (call.state || "result") as ToolState,
          })),
        };
        await saveMessage(messageToSave);
      },
      [saveMessage]
    ),
  });

  // Store chat instance in ref
  chatRef.current = chat;

  // Destructure chat properties
  const { messages, input, setInput, append, isLoading, setMessages } = chat;

  // Update chat messages when thread messages change
  useEffect(() => {
    if (currentMessages) {
      setMessages(
        currentMessages.map((msg) => ({
          id: msg.id || String(Date.now()), // Ensure id is always present
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        }))
      );
    }
  }, [currentMessages, setMessages]);

  const [showCommands, setShowCommands] = useState(false);
  const [pendingImageRequests] = useState(() => new Set<string>());
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
  const [completedImages] = useState(() => new Set<string>());
  const [generatedImages, setGeneratedImages] = useState<
    Record<string, { url: string; credits: number }>
  >({});
  const [pendingVisualizations] = useState(() => new Set<string>());
  const [pendingQuizzes] = useState(() => new Set<string>());
  const [generatedQuizzes, setGeneratedQuizzes] = useState<Record<string, any>>(
    {}
  );
  const [generatedVideos, setGeneratedVideos] = useState<
    Record<string, string>
  >({});
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(
    null
  );

  const handleAnswerSubmit = async (data: {
    studentAnswer: number;
    correctAnswer: number;
    question: string;
    topic: string;
    level: string;
  }) => {
    const userMessage = {
      id: String(Date.now()),
      role: "user" as const,
      content: `Evaluate my answer: ${data.studentAnswer} for the question: "${data.question}"`,
      toolCalls: [
        {
          tool: "evaluateAnswer",
          parameters: data,
        },
      ],
    };
    await append(userMessage);
  };

  const handleQuizAnswer = useCallback(
    async (data: {
      selectedOption: { id: string; text: string; isCorrect: boolean };
      question: string;
      allOptions: Array<{ id: string; text: string; isCorrect: boolean }>;
      subject: string;
      difficulty: string;
      explanation: string;
    }) => {
      const userMessage = {
        id: String(Date.now()),
        role: "user" as const,
        content: `I chose: "${data.selectedOption.text}" for the question: "${data.question}"`,
        toolCalls: [
          {
            tool: "evaluateQuizAnswer",
            parameters: {
              selectedAnswer: data.selectedOption,
              question: data.question,
              allOptions: data.allOptions,
              subject: data.subject,
              difficulty: data.difficulty,
              explanation: data.explanation,
              isCorrect: data.selectedOption.isCorrect,
            },
          },
        ],
        isHidden: true, // Add this flag
      };
      await append(userMessage);
    },
    [append]
  );

  const handleImageGeneration = async (
    toolCallId: string,
    params: {
      prompt: string;
      style: string;
      imageSize: string;
      numInferenceSteps: number;
      numImages: number;
      enableSafetyChecker: boolean;
    }
  ) => {
    if (
      pendingImageRequests.has(toolCallId) ||
      completedImages.has(toolCallId)
    ) {
      return;
    }
    pendingImageRequests.add(toolCallId);
    try {
      const response = await fetch("/api/gen-chat-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await response.json();
      pendingImageRequests.delete(toolCallId);
      completedImages.add(toolCallId);
      if (data.images?.[0]) {
        const imageUrl = data.images[0].url;
        setLastGeneratedImage(imageUrl); // Store the last generated image URL
        setGeneratedImages((prev) => ({
          ...prev,
          [toolCallId]: {
            url: imageUrl,
            credits: data.remainingCredits,
          },
        }));
        setRemainingCredits(data.remainingCredits);
      }
    } catch (error) {
      console.error("Image generation failed:", error);
      pendingImageRequests.delete(toolCallId);
      setGeneratedImages((prev) => ({
        ...prev,
        [toolCallId]: { url: "error", credits: remainingCredits || 0 },
      }));
    }
  };

  const handleQuizGeneration = useCallback(
    async (
      toolCallId: string,
      params: {
        subject: string;
        difficulty: string;
      }
    ) => {
      if (pendingQuizzes.has(toolCallId)) {
        return;
      }

      pendingQuizzes.add(toolCallId);
      try {
        const response = await fetch("/api/gen-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error("Failed to generate quiz");
        }

        const data = await response.json();
        setGeneratedQuizzes((prev) => ({
          ...prev,
          [toolCallId]: data,
        }));
      } catch (error) {
        console.error("Quiz generation failed:", error);
        setGeneratedQuizzes((prev) => ({
          ...prev,
          [toolCallId]: {
            error: "Failed to generate quiz",
          },
        }));
      } finally {
        pendingQuizzes.delete(toolCallId);
      }
    },
    [pendingQuizzes]
  );

  const handleVisualization = async (subject: string, concept: string) => {
    try {
      const response = await fetch("/api/generate-visualization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, concept }),
      });
      if (!response.ok) {
        throw new Error("Failed to generate visualization");
      }
      const { visualization } = await response.json();
      return { code: visualization };
    } catch (error) {
      console.error("Visualization generation failed:", error);
      return { error: "Failed to generate visualization" };
    }
  };

  // Update tool calls to include required id
  const createToolCall = (
    tool: string,
    parameters: Record<string, any>
  ): ToolCall => ({
    id: String(Date.now()),
    tool,
    parameters,
    state: "pending",
  });

  const handleDirectCommand = async (command: string) => {
    // Ensure thread exists before handling command
    if (!threadId) {
      const newThreadId = await createThread();
      // Wait for thread ID to be set in state
      await new Promise((resolve) => setTimeout(resolve, 100));
      await router.push(`/tools/gen-chat?thread=${newThreadId}`);
    }

    const parts = command.slice(1).split(" ");
    const toolName = parts[0].toLowerCase();
    let userMessage: UserMessage | undefined;

    const baseMessage = {
      id: String(Date.now()),
      createdAt: new Date(),
    };

    if (toolName === "math") {
      const level = parts[1] || "easy";
      const topic = parts[2] || "addition";
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Generate a ${level} ${topic} math problem`,
        toolCalls: [createToolCall("generateMathProblem", { level, topic })],
      };
    } else if (toolName === "quiz") {
      const subject = parts[1] || "general";
      const difficulty = parts[2] || "easy";
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Generate a ${difficulty} quiz about ${subject}`,
        toolCalls: [createToolCall("generateQuiz", { subject, difficulty })],
      };
    } else if (toolName === "image") {
      const prompt = parts.slice(1, -1).join(" ");
      const style = parts[parts.length - 1] || "realistic_image";
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Generate an educational image about: ${prompt}`,
        toolCalls: [
          createToolCall("generateImage", {
            prompt,
            style,
            imageSize: "square_hd",
            numInferenceSteps: 1,
            numImages: 1,
            enableSafetyChecker: true,
          }),
        ],
      };
    } else if (toolName === "visualize") {
      const subject = parts[1] || "physics";
      const concept = parts.slice(2).join(" ") || "";
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Generate a visualization of ${concept} ${subject}`,
        toolCalls: [
          createToolCall("generateVisualization", { subject, concept }),
        ],
      };
    } else if (toolName === "mindmap") {
      const topic = parts.slice(1).join(" ");
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Generate a mind map about ${topic}`,
        toolCalls: [createToolCall("generateMindMap", { topic })],
      };
    } else if (toolName === "video") {
      const prompt = parts.slice(1).join(" ");
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Generate a video with this description: ${prompt}`,
        toolCalls: [
          createToolCall("generateVideo", {
            prompt,
            imageUrl: lastGeneratedImage, // Pass the last generated image URL
          }),
        ],
      };
    }

    if (!userMessage) {
      userMessage = {
        ...baseMessage,
        role: "user",
        content: `Unknown command: ${command}`,
      };
    }

    try {
      await saveMessage(userMessage);
      await append({ ...userMessage });
    } catch (error) {
      console.error("Failed to save command message:", error);
    }
  };

  // Load thread messages when switching threads
  const handleThreadSelect = async (selectedThreadId: string) => {
    try {
      const messages = await loadThread(selectedThreadId);
      if (messages) {
        setMessages(messages);
      }
      router.push(`/tools/gen-chat?thread=${selectedThreadId}`);
    } catch (error) {
      console.error("Failed to load thread:", error);
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    if (confirm("Are you sure you want to delete this chat?")) {
      try {
        await deleteThread(threadId);
        setMessages([]); // Clear messages in useChat state
        setCurrentMessages([]); // Clear messages in thread context
        setInput(""); // Clear input
        // Reset chat instance
        chatRef.current = null;
        // Remove thread from URL and reset threadId
        router.replace("/tools/gen-chat", { scroll: false });
      } catch (error) {
        console.error("Failed to delete thread:", error);
      }
    }
  };

  const handleNewThread = async () => {
    try {
      const newThreadId = await startNewThread();
      setMessages([]); // Clear messages in useChat state
      router.push(`/tools/gen-chat?thread=${newThreadId}`);
    } catch (error) {
      console.error("Failed to create new thread:", error);
    }
  };

  const [simulationCode, setSimulationCode] = useState<string | null>(null);
  const simulationCodeRef = useRef<string | null>(null);

  // Ensure thread exists before sending message
  const handleMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim()) return; // Don't process empty messages

    try {
      let activeThreadId = threadId;
      // Create new thread if none exists
      if (!activeThreadId) {
        activeThreadId = await createThread();
        await router.push(`/tools/gen-chat?thread=${activeThreadId}`);
        // Wait for thread creation to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Verify thread exists before proceeding
      if (!activeThreadId) {
        console.warn("No active thread available");
        return;
      }

      const userMessage: ChatMessage = {
        id: String(Date.now()),
        role: "user",
        content: input,
        createdAt: new Date(),
      };

      try {
        // Attempt to save message first
        await saveMessage(userMessage, activeThreadId);

        // Only proceed with chat if message save was successful
        if (input.toLowerCase().includes("video") && lastGeneratedImage) {
          const messageWithTool: ChatMessage = {
            ...userMessage,
            toolCalls: [
              createToolCall("generateVideo", {
                prompt: input,
                imageUrl: lastGeneratedImage,
              }),
            ],
          };
          await append(messageWithTool);
        } else if (input.startsWith("/")) {
          await handleDirectCommand(input);
        } else {
          await chatRef.current?.append(userMessage);
        }

        setInput("");
      } catch (error) {
        console.error("Message processing failed:", error);
        // Consider showing a user-friendly error message here
      }
    } catch (error) {
      console.error("Thread creation failed:", error);
      // Consider showing a user-friendly error message here
    }
  };

  const handleFormSubmit = handleMessageSubmit;

  const handleInputChange = (value: string) => {
    setInput(value);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen">
        <ThreadList
          threads={threads}
          currentThreadId={threadId}
          onThreadSelect={handleThreadSelect}
          onDeleteThread={handleDeleteThread}
          onNewThread={handleNewThread}
          messages={messages}
          isLoading={isLoading}
        />
        <ChatArea
          messages={messages}
          input={input}
          isLoading={isLoading}
          onInputChange={handleInputChange}
          onSubmit={handleFormSubmit}
          simulationCode={simulationCode}
          simulationCodeRef={simulationCodeRef}
          generatedImages={generatedImages}
          generatedQuizzes={generatedQuizzes}
          pendingQuizzes={pendingQuizzes}
          pendingImageRequests={pendingImageRequests}
          completedImages={completedImages}
          pendingVisualizations={pendingVisualizations}
          handleAnswerSubmit={handleAnswerSubmit}
          handleImageGeneration={handleImageGeneration}
          handleQuizGeneration={handleQuizGeneration}
          handleVisualization={handleVisualization}
          handleQuizAnswer={handleQuizAnswer}
          onSimulationCode={(code: string) => setSimulationCode(code)}
          generatedVideos={generatedVideos}
          setGeneratedVideos={setGeneratedVideos}
          lastGeneratedImage={lastGeneratedImage}
        />
      </div>
    </TooltipProvider>
  );
}
