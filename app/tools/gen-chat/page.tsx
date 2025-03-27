"use client";

import { useChat } from "ai/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRef, useState, useCallback, useEffect, Suspense } from "react"; // Add Suspense import
import { useSidebar } from "@/components/ui/sidebar";
import { ChatArea } from "./components/chat-area";
import { useChatThread } from "@/app/tools/gen-chat/hooks/useChatThread";
import { ThreadList } from "./components/thread-list";
import { useRouter, useSearchParams } from "next/navigation";
import { Message } from "ai";
import { ChatMessage } from "@/types/chat";
import { useLanguageSettings } from "@/app/tools/gen-chat/hooks/useLanguageSettings";
import { useTools } from "@/app/tools/gen-chat/hooks/useTools";
import { createClient } from "@/utils/supabase/client";

function ChatPageContent() {
  const router = useRouter();
  const { setOpen } = useSidebar();
  const { language } = useLanguageSettings();
  const {
    threadId,
    threads,
    createThread,
    saveMessage,
    loadThread,
    deleteThread,
    startNewThread,
    currentMessages,
    setCurrentMessages,
    isOwner,
  } = useChatThread();
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserRole(user.user_metadata.role ?? null);
      }
    };

    fetchUser();
  }, []);

  // Replace direct window usage with useSearchParams to avoid "window is not defined"
  const searchParams = useSearchParams();
  const lessonPlanIdParam = searchParams.get("lessonPlanId");
  const scheduleDataParam = searchParams.get("scheduleData");
  const teachingModeParam = searchParams.get("teachingMode") === "true";
  const userInputParam = searchParams.get("userInput");
  const userInputInitRef = useRef(false);

  // State management
  const [showCommands, setShowCommands] = useState(false);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(
    null
  );
  const [simulationCode, setSimulationCode] = useState<string | null>(null);
  const simulationCodeRef = useRef<string | null>(null);
  const chatRef = useRef<any>(null);
  // Replace initial state with URL value:
  const [isTeachingMode, setIsTeachingMode] = useState(teachingModeParam);

  // Add this function to handle teaching mode
  const handleTeachingModeToggle = () => {
    setIsTeachingMode(!isTeachingMode);
  };

  // Initialize tools hook
  const tools = useTools({
    lastGeneratedImage,
    setLastGeneratedImage,
  });

  // Add lessonPlanId to chat body
  const chat = useChat({
    api: "/api/gen-chat",
    id: threadId,
    initialMessages: currentMessages.map((msg) => ({
      id: msg.id || String(Date.now()),
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    })),
    body: {
      id: threadId,
      language,
      teachingMode: isTeachingMode,
      lessonPlanId: lessonPlanIdParam, // Add this line
    },
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
            state: (call.state || "result") as "pending" | "result",
          })),
        };
        await saveMessage(messageToSave);
      },
      [saveMessage]
    ),
  });

  // Store chat instance in ref
  chatRef.current = chat;
  const { messages, input, setInput, append, isLoading, setMessages } = chat;

  // Add initialization control
  const initializationRef = useRef(false);
  const threadInitRef = useRef(false);

  // Side effects
  useEffect(() => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    setOpen(false);
    const searchParams = new URLSearchParams(window.location.search);
    const threadParam = searchParams.get("thread");
    if (threadParam && threadParam !== "new") {
      handleThreadSelect(threadParam);
    }
  }, [setOpen]);

  useEffect(() => {
    if (currentMessages) {
      setMessages(
        currentMessages.map((msg) => ({
          id: msg.id || String(Date.now()),
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        }))
      );
    }
  }, [currentMessages, setMessages]);

  // Add this helper function
  const formatLessonPlanMessage = (lessonPlan: any) => {
    return (
      `Hey buddy, "${lessonPlan.chapter_topic}" in ${lessonPlan.subject} (I'm from grade ${lessonPlan.grade}).\n\n` +
      `Class Details:\n` +
      `- Duration: ${lessonPlan.class_duration} minutes\n` +
      `- Number of sessions: ${lessonPlan.number_of_days}\n` +
      `- Board: ${lessonPlan.board || "Not specified"}\n\n` +
      `Learning Objectives:\n${lessonPlan.learning_objectives || "Not specified"}\n\n` +
      `Please help me understand the key concepts for this lesson.`
    );
  };

  // Modify the lesson plan initialization effect
  useEffect(() => {
    const initializeLessonPlan = async () => {
      if (threadInitRef.current || !lessonPlanIdParam || messages.length > 0)
        return;
      threadInitRef.current = true;

      try {
        let activeThreadId = threadId;
        if (!activeThreadId) {
          activeThreadId = await createThread();
          await router.push(
            `/tools/gen-chat?thread=${activeThreadId}&teachingMode=${isTeachingMode}&lessonPlanId=${lessonPlanIdParam}${
              scheduleDataParam ? `&scheduleData=${scheduleDataParam}` : ""
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const response = await fetch(`/api/lesson-plans/${lessonPlanIdParam}`);
        if (!response.ok) throw new Error("Failed to fetch lesson plan");

        const lessonPlan = await response.json();
        let messageContent;

        if (userInputParam) {
          // If userInput is present, use it directly
          messageContent = userInputParam;
        } else {
          // Otherwise use the formatted lesson plan message
          messageContent = formatLessonPlanMessage(lessonPlan);

          // Add schedule-specific context if available
          if (scheduleDataParam) {
            const scheduleData = JSON.parse(
              decodeURIComponent(scheduleDataParam)
            );
            messageContent += `\n\nLet's focus on Day ${scheduleData.day}: ${scheduleData.topicHeading}\n`;
            messageContent += `Activity: ${scheduleData.schedule.type} - ${scheduleData.schedule.title}\n`;
            messageContent += `Content: ${scheduleData.schedule.content}\n`;
            messageContent += `Duration: ${scheduleData.schedule.timeAllocation} minutes\n\n`;
            messageContent +=
              "Please help me understand this specific part of the lesson.";
          }
        }

        const userMessage: ChatMessage = {
          id: String(Date.now()),
          role: "user",
          content: messageContent,
          createdAt: new Date(),
        };

        await saveMessage(userMessage, activeThreadId);
        await append(userMessage);

        router.replace(`/tools/gen-chat?thread=${activeThreadId}`);
      } catch (error) {
        console.error("Error initializing lesson plan chat:", error);
      }
    };

    initializeLessonPlan();
  }, [
    lessonPlanIdParam,
    scheduleDataParam,
    messages.length,
    append,
    threadId,
    createThread,
    router,
    isTeachingMode,
    saveMessage,
    userInputParam, // Add userInputParam to dependencies
  ]);

  useEffect(() => {
    if (userInputInitRef.current || !userInputParam) return;
    userInputInitRef.current = true;
    setMessages((prevMessages: ChatMessage[]) => [
      ...prevMessages,
      {
        id: String(Date.now()),
        role: "user",
        content: `User says: ${userInputParam}`,
        createdAt: new Date(),
      },
    ]);
  }, [userInputParam, setMessages]);

  // Update handleThreadSelect to handle 'new' thread parameter
  const handleThreadSelect = async (selectedThreadId: string) => {
    if (selectedThreadId === "new") {
      const newThreadId = await startNewThread();
      router.push(
        `/tools/gen-chat?thread=${newThreadId}&teachingMode=${isTeachingMode}&lessonPlanId=${lessonPlanIdParam}`
      );
      return;
    }

    try {
      const messages = await loadThread(selectedThreadId);
      if (messages) setMessages(messages);
      router.push(`/tools/gen-chat?thread=${selectedThreadId}`);
    } catch (error) {
      console.error("Failed to load thread:", error);
      const newThreadId = await startNewThread();
      router.push(
        `/tools/gen-chat?thread=${newThreadId}&teachingMode=${isTeachingMode}&lessonPlanId=${lessonPlanIdParam}`
      );
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    if (confirm("Are you sure you want to delete this chat?")) {
      try {
        await deleteThread(threadId);
        setMessages([]);
        setCurrentMessages([]);
        setInput("");
        chatRef.current = null;
        router.replace("/tools/gen-chat", { scroll: false });
      } catch (error) {
        console.error("Failed to delete thread:", error);
      }
    }
  };

  const handleNewThread = async () => {
    try {
      const newThreadId = await startNewThread();
      setMessages([]);
      router.push(`/tools/gen-chat?thread=${newThreadId}`);
    } catch (error) {
      console.error("Failed to create new thread:", error);
    }
  };

  // Handle direct commands from the user
  const processDirectCommand = async (command: string) => {
    // Ensure thread exists
    if (!threadId) {
      const newThreadId = await createThread();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await router.push(`/tools/gen-chat?thread=${newThreadId}`);
    }

    try {
      const baseMessage = await tools.handleDirectCommand(command);
      await saveMessage(baseMessage);
      await append(baseMessage);
    } catch (error) {
      console.error("Failed to process command:", error);
    }
  };

  // Handle message submission
  const handleMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    try {
      let activeThreadId = threadId;
      if (!activeThreadId) {
        activeThreadId = await createThread();
        await router.push(`/tools/gen-chat?thread=${activeThreadId}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!activeThreadId) {
        console.warn("No active thread available");
        return;
      }

      // Create message content once
      const messageContent = isTeachingMode
        ? `Teach me about: ${input}`
        : input;

      const userMessage: ChatMessage = {
        id: String(Date.now()),
        role: "user",
        content: messageContent,
        createdAt: new Date(),
      };

      try {
        await saveMessage(userMessage, activeThreadId);

        if (input.toLowerCase().includes("video") && lastGeneratedImage) {
          const messageWithTool: ChatMessage = {
            ...userMessage,
            toolCalls: [
              tools.createToolCall("generateVideo", {
                prompt: input,
                imageUrl: lastGeneratedImage,
              }),
            ],
          };
          await append(messageWithTool);
        } else if (input.startsWith("/")) {
          await processDirectCommand(input);
        } else {
          await chatRef.current?.append({
            ...userMessage,
            content: messageContent, // Use the same content
          });
        }

        setInput("");
        if (isTeachingMode) {
          // Automatically switch to interactive mode after generating the lesson
          setIsTeachingMode(false);
        }
      } catch (error) {
        console.error("Message processing failed:", error);
      }
    } catch (error) {
      console.error("Thread creation failed:", error);
    }
  };

  // Process tool answers
  const processToolAnswer = async (answer: any) => {
    await append(answer);
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
          language={language}
          userRole={userRole ?? ""}
        />
        <ChatArea
          messages={messages}
          input={input}
          isLoading={isLoading}
          onInputChange={setInput}
          onSubmit={handleMessageSubmit}
          simulationCode={simulationCode}
          simulationCodeRef={simulationCodeRef}
          generatedImages={tools.generatedImages}
          generatedQuizzes={tools.generatedQuizzes}
          pendingQuizzes={tools.pendingQuizzes}
          pendingImageRequests={tools.pendingImageRequests}
          completedImages={tools.completedImages}
          pendingVisualizations={tools.pendingVisualizations}
          handleQuizAnswer={async (data) => {
            const answer = await tools.handleQuizAnswer(data);
            processToolAnswer(answer);
          }}
          handleImageGeneration={tools.handleImageGeneration}
          handleQuizGeneration={tools.handleQuizGeneration}
          handleVisualization={tools.handleVisualization}
          onSimulationCode={setSimulationCode}
          generatedVideos={tools.generatedVideos}
          setGeneratedVideos={tools.setGeneratedVideos}
          lastGeneratedImage={lastGeneratedImage}
          isOwner={isOwner}
          isTeachingMode={isTeachingMode}
          onTeachingModeToggle={handleTeachingModeToggle}
          generatedAssessments={tools.generatedAssessments}
          pendingAssessments={tools.pendingAssessments}
          handleAssessmentGeneration={tools.handleAssessmentGeneration}
          assessmentIds={tools.assessmentIds}
        />
      </div>
    </TooltipProvider>
  );
}

// Create a loading component
function Loading() {
  return <div className="p-4">Loading...</div>;
}

// Main page component with Suspense boundary
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ChatPageContent />
    </Suspense>
  );
}
