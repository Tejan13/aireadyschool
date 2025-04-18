import { useState, useCallback } from 'react';
import { ToolCall } from '@/types/chat';

interface GeneratedImage {
  url: string;
  credits: number;
}

interface UseToolsProps {
  lastGeneratedImage: string | null;
  setLastGeneratedImage: (url: string | null) => void;
}

type AssessmentData = {
  assessment: any[];
  id: number;  // Add this to store the database ID
};

export function useTools({ lastGeneratedImage, setLastGeneratedImage }: UseToolsProps) {
  const [pendingImageRequests] = useState(() => new Set<string>());
  const [completedImages] = useState(() => new Set<string>());
  const [generatedImages, setGeneratedImages] = useState<Record<string, GeneratedImage>>({});
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
  
  const [pendingVisualizations] = useState(() => new Set<string>());
  const [pendingQuizzes] = useState(() => new Set<string>());
  const [generatedQuizzes, setGeneratedQuizzes] = useState<Record<string, any>>({});
  const [generatedVideos, setGeneratedVideos] = useState<Record<string, string>>({});
  
  const [generatedAssessments, setGeneratedAssessments] = useState<Record<string, any>>({});
  const [pendingAssessments] = useState(() => new Set<string>());
  const [assessmentIds, setAssessmentIds] = useState<Record<string, number>>({});

  // Create a tool call object
  const createToolCall = (tool: string, parameters: Record<string, any>): ToolCall => ({
    id: String(Date.now()),
    tool,
    parameters,
    state: "pending",
  });

  // Handle quiz answer submission
  const handleQuizAnswer = useCallback(async (data: {
    selectedOption: { id: string; text: string; isCorrect: boolean };
    question: string;
    allOptions: Array<{ id: string; text: string; isCorrect: boolean }>;
    subject: string;
    difficulty: string;
    explanation: string;
  }) => {
    return {
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
      isHidden: true,
    };
  }, []);

  // Handle image generation
  const handleImageGeneration = useCallback(async (
    toolCallId: string,
    params: {
      prompt: string;
      imageSize: string;
      numInferenceSteps: number;
      numImages: number;
      enableSafetyChecker: boolean;
    }
  ) => {
    if (pendingImageRequests.has(toolCallId) || completedImages.has(toolCallId))
      return;

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
        setLastGeneratedImage(imageUrl);
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
  }, [pendingImageRequests, completedImages, remainingCredits, setLastGeneratedImage]);

  // Handle quiz generation
  const handleQuizGeneration = useCallback(async (
    toolCallId: string,
    params: {
      subject: string;
      difficulty: string;
    }
  ) => {
    if (pendingQuizzes.has(toolCallId)) return;

    pendingQuizzes.add(toolCallId);
    try {
      const response = await fetch("/api/gen-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error("Failed to generate quiz");

      const data = await response.json();
      setGeneratedQuizzes((prev) => ({ ...prev, [toolCallId]: data }));
    } catch (error) {
      console.error("Quiz generation failed:", error);
      setGeneratedQuizzes((prev) => ({
        ...prev,
        [toolCallId]: { error: "Failed to generate quiz" },
      }));
    } finally {
      pendingQuizzes.delete(toolCallId);
    }
  }, [pendingQuizzes]);

  // Handle visualization generation
  const handleVisualization = useCallback(async (subject: string, concept: string) => {
    try {
      const response = await fetch("/api/generate-visualization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, concept }),
      });

      if (!response.ok) throw new Error("Failed to generate visualization");

      const { visualization } = await response.json();
      return { code: visualization };
    } catch (error) {
      console.error("Visualization generation failed:", error);
      return { error: "Failed to generate visualization" };
    }
  }, []);

  // Handle assessment generation
  const handleAssessmentGeneration = useCallback(async (
    toolCallId: string,
    params: {
      subject: string;
      topic: string;
      assessmentType: 'mcq' | 'truefalse' | 'shortanswer';
      difficulty: string;
      questionCount: number;
      learningOutcomes: string[];
    }
  ) => {
    if (pendingAssessments.has(toolCallId)) return;

    pendingAssessments.add(toolCallId);
    try {
      const response = await fetch("/api/generate-assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          country: "Global", 
          board: "General", 
          classLevel: "High School", 
        }),
      });

      if (!response.ok) throw new Error("Failed to generate assessment");

      const data: AssessmentData = await response.json();
      
      // Store the database ID mapped to the toolCallId
      setAssessmentIds(prev => ({
        ...prev,
        [toolCallId]: data.id
      }));

      // Transform the assessment data to match our component's expected format
      const transformedQuestions = data.assessment.map((q: any) => ({
        question: q.question,
        type: params.assessmentType,
        options: q.options || null,
        correctAnswer: params.assessmentType === 'mcq' ? 
          Number(q.correctAnswer) : 
          params.assessmentType === 'truefalse' ? 
            Boolean(q.correctAnswer) : 
            q.correctAnswer
      }));

      setGeneratedAssessments((prev) => ({ 
        ...prev, 
        [toolCallId]: transformedQuestions 
      }));
    } catch (error) {
      console.error("Assessment generation failed:", error);
      setGeneratedAssessments((prev) => ({
        ...prev,
        [toolCallId]: { error: "Failed to generate assessment" },
      }));
    } finally {
      pendingAssessments.delete(toolCallId);
    }
  }, [pendingAssessments]);

  // Handle direct commands processing
  const handleDirectCommand = useCallback(async (command: string) => {
    const parts = command.slice(1).split(" ");
    const toolName = parts[0].toLowerCase();
    const baseMessage = {
      id: String(Date.now()),
      role: "user" as const,
      createdAt: new Date(),
      content: "",
      toolCalls: [] as ToolCall[],
    };

    switch (toolName) {
      case "quiz":
        const subject = parts[1] || "general";
        const difficulty = parts[2] || "easy";
        baseMessage.content = `Generate a ${difficulty} quiz about ${subject}`;
        baseMessage.toolCalls = [
          createToolCall("generateQuiz", { subject, difficulty }),
        ];
        break;
      case "image":
        const prompt = parts.slice(1, -1).join(" ");
        baseMessage.content = `Generate an educational image about: ${prompt}`;
        baseMessage.toolCalls = [
          createToolCall("generateImage", {
            prompt,
            imageSize: "square_hd",
            numInferenceSteps: 1,
            numImages: 1,
            enableSafetyChecker: true,
          }),
        ];
        break;
      case "visualize":
        const vizSubject = parts[1] || "physics";
        const concept = parts.slice(2).join(" ") || "";
        baseMessage.content = `Generate a visualization of ${concept} ${vizSubject}`;
        baseMessage.toolCalls = [
          createToolCall("generateVisualization", {
            subject: vizSubject,
            concept,
          }),
        ];
        break;
      case "mindmap":
        const mindmapTopic = parts.slice(1).join(" ");
        baseMessage.content = `Generate a mind map about ${mindmapTopic}`;
        baseMessage.toolCalls = [
          createToolCall("generateMindMap", { mindmapTopic }),
        ];
        break;
      case "video":
        const videoPrompt = parts.slice(1).join(" ");
        baseMessage.content = `Generate a video with this description: ${videoPrompt}`;
        baseMessage.toolCalls = [
          createToolCall("generateVideo", {
            prompt: videoPrompt,
            imageUrl: lastGeneratedImage,
          }),
        ];
        break;
      case "assess":
        const [assessSubject, assessTopic, type = "mcq", assessDifficulty = "medium"] = parts.slice(1);
        const questionCount = 5;
        baseMessage.content = `Generate a ${assessDifficulty} ${type} assessment about ${assessTopic} in ${assessSubject}`;
        baseMessage.toolCalls = [
          createToolCall("generateAssessment", {
            subject: assessSubject,
            topic: assessTopic,
            assessmentType: type,
            difficulty: assessDifficulty,
            questionCount,
            learningOutcomes: [`Understand ${assessTopic} in ${assessSubject}`],
          }),
        ];
        break;
      case "document":
        const docContent = parts.slice(1).join(" ");
        baseMessage.content = `Open document generator with content: ${docContent}`;
        baseMessage.toolCalls = [
          createToolCall("generateDocument", {
            initialContent: docContent,
            title: "Generated Document"
          }),
        ];
        break;
      default:
        baseMessage.content = `Unknown command: ${command}`;
        baseMessage.toolCalls = [];
    }

    return baseMessage;
  }, [lastGeneratedImage, createToolCall]);

  // Handle video completion
  const handleVideoComplete = useCallback((toolCallId: string, videoUrl: string) => {
    setGeneratedVideos(prev => ({ ...prev, [toolCallId]: videoUrl }));
  }, []);

  return {
    pendingImageRequests,
    completedImages,
    generatedImages,
    pendingVisualizations,
    pendingQuizzes,
    generatedQuizzes,
    generatedVideos,
    setGeneratedVideos,
    generatedAssessments,
    pendingAssessments,
    assessmentIds,
    handleQuizAnswer,
    handleImageGeneration,
    handleQuizGeneration,
    handleVisualization,
    handleAssessmentGeneration,
    handleDirectCommand,
    handleVideoComplete,
    createToolCall
  };
}
