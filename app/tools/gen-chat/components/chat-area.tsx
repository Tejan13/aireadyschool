import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Bot, User, Volume2, VolumeX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { CommandInput } from "./command-input";
import { useNowPlaying } from "@/app/tools/gen-chat/hooks/useNowPlaying";
import { useAudioSettings } from "@/app/tools/gen-chat/hooks/useAudioSettings";
import { ChatAreaProps } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { ToolRenderer } from "./ToolRenderer";

export const ChatArea = ({
  messages,
  input,
  isLoading,
  onInputChange,
  onSubmit,
  simulationCode,
  simulationCodeRef,
  generatedImages,
  pendingImageRequests,
  completedImages,
  pendingVisualizations,
  handleAnswerSubmit,
  handleImageGeneration,
  handleVisualization,
  onSimulationCode,
  generatedQuizzes,
  pendingQuizzes,
  handleQuizGeneration,
  handleQuizAnswer,
  generatedVideos,
  setGeneratedVideos,
  lastGeneratedImage,
  isOwner = true,
}: ChatAreaProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [lastMessageTime, setLastMessageTime] = useState<number | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const { stop: stopAudio, play: playAudio } = useNowPlaying();
  const { 
    isAudioEnabled, 
    toggleAudio, 
    hasUserInteracted,
    markUserInteraction 
  } = useAudioSettings();
  const toolsContentRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingStreamRef = useRef<boolean>(false);
  const ttsControllerRef = useRef<AbortController | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);

  const toolInvocations = messages.flatMap(
    (message) => message.toolInvocations || []
  );

  // Initialize audio context
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return () => {
      stopStreamingAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // Play the next audio buffer in the queue
  const playNextInQueue = async () => {
    if (!audioContextRef.current || !isPlayingStreamRef.current || audioQueueRef.current.length === 0) {
      return;
    }
    
    try {
      const buffer = audioQueueRef.current.shift();
      if (!buffer) return;
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      
      audioSourcesRef.current.push(source);
      
      source.onended = () => {
        // Remove this source from the sources array
        audioSourcesRef.current = audioSourcesRef.current.filter(s => s !== source);
        
        // Play next buffer if there's more in the queue
        if (audioQueueRef.current.length > 0) {
          playNextInQueue();
        } else if (audioSourcesRef.current.length === 0) {
          // If no more sources are playing and queue is empty, we're done
          isPlayingStreamRef.current = false;
          setPlayingMessageId(null);
        }
      };
      
      source.start(0);
    } catch (err) {
      console.error("Error playing audio chunk:", err);
    }
  };

  // Process and play a new audio chunk
  const processAudioChunk = async (base64Data: string) => {
    if (!audioContextRef.current) return;
    
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Decode audio data with lower latency priority
      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
      
      // Add to queue
      audioQueueRef.current.push(audioBuffer);
      
      // If we're not playing yet, start playing immediately
      if (!isPlayingStreamRef.current) {
        isPlayingStreamRef.current = true;
        // Start playback immediately without delay
        setTimeout(() => playNextInQueue(), 0);
      }
    } catch (err) {
      console.error("Error processing audio chunk:", err);
    }
  };

  // Stop streaming audio
  const stopStreamingAudio = () => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      webSocketRef.current.close();
      webSocketRef.current = null;
    }
    
    if (ttsControllerRef.current) {
      ttsControllerRef.current.abort();
      ttsControllerRef.current = null;
    }
    
    if (!isPlayingStreamRef.current) return;
    
    isPlayingStreamRef.current = false;
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current = [];
    audioQueueRef.current = [];
    setPlayingMessageId(null);
  };

  // Scroll tools panel to bottom when new tools are added
  useEffect(() => {
    if (toolsContentRef.current) {
      toolsContentRef.current.scrollTop = toolsContentRef.current.scrollHeight;
    }
  }, [toolInvocations.length]);

  // Handle talking state
  useEffect(() => {
    if (messages.length > 0) {
      setLastMessageTime(Date.now());
      setIsTalking(true);
      const timer = setTimeout(() => setIsTalking(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Add event listeners to capture user interaction with the page
  useEffect(() => {
    const handleUserInteraction = () => {
      markUserInteraction();
    };
    
    // Common user interaction events
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    
    events.forEach(event => {
      document.addEventListener(event, handleUserInteraction, { once: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleUserInteraction);
      });
    };
  }, [markUserInteraction]);

  // Clean up audio resources when component unmounts or page changes
  useEffect(() => {
    const handleBeforeUnload = () => {
      stopStreamingAudio();
    };

    // Handle page unload
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Add visibility change event to stop audio when user switches tabs or minimizes
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopStreamingAudio();
      }
    });

    return () => {
      stopStreamingAudio();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleBeforeUnload);
    };
  }, []);

  // Handle text-to-speech
  const handleTTS = async (messageId: string, text: string) => {
    try {
      if (playingMessageId === messageId) {
        stopStreamingAudio();
        return;
      }

      stopStreamingAudio();
      setPlayingMessageId(messageId);

      if (!hasUserInteracted) {
        console.log("User has not interacted with the page yet, skipping audio playback");
        setPlayingMessageId(null);
        return;
      }

      // Extract only the first few sentences for immediate playback to reduce initial delay
      const firstChunk = text.split('.').slice(0, 2).join('.') + '.';
      
      // Clean text for TTS
      const cleanText = text
        .replace(/\[.*?\]/g, '') // Remove markdown links
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
        .replace(/\*(.*?)\*/g, '$1') // Remove italic
        .replace(/`(.*?)`/g, '$1') // Remove code blocks
        .trim();

      // Create a new abort controller for this request
      ttsControllerRef.current = new AbortController();
      
      const response = await fetch(`/api/gen-chat-tts`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Priority": "high" // Add priority header
        },
        body: JSON.stringify({ 
          text: cleanText,
          priority: "high"  // Signal high priority for processing
        }),
        signal: ttsControllerRef.current.signal
      });

      if (!response.ok) throw new Error("TTS request failed");
      
      if (!response.body) {
        throw new Error("Response body is null");
      }

      // Process the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // Read and process chunks
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        // Process the chunk
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'audio') {
              // Process the audio chunk for immediate playback
              await processAudioChunk(data.content);
            }
          } catch (e) {
            console.error('Error parsing chunk:', e);
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error("TTS error:", error);
      }
      setPlayingMessageId(null);
    }
  };

  // Watch for loading state changes to trigger TTS only when a new message is received during loading
  useEffect(() => {
    // If we were loading and now we're not, and audio is enabled, read the last assistant message
    if (!isLoading && messages.length > 0 && isAudioEnabled && hasUserInteracted) {
      const lastMessage = messages[messages.length - 1];
      if (
        lastMessage.role === "assistant" && 
        typeof lastMessage.content === "string" &&
        !lastMessage.fromHistory &&  // Don't read messages from history
        !playingMessageId // Not already playing something
      ) {
        handleTTS(lastMessage.id, lastMessage.content);
      }
    }
  }, [isLoading, messages, isAudioEnabled, hasUserInteracted]);

  const handleVideoComplete = (toolCallId: string, videoUrl: string) => {
    setGeneratedVideos({ ...generatedVideos, [toolCallId]: videoUrl });
  };

  const handleAudioToggle = () => {
    if (isAudioEnabled && playingMessageId) {
      stopStreamingAudio();
    }
    toggleAudio();
  };

  const renderMessage = (message: any) => (
    <div
      key={message.id}
      className={cn(
        "flex gap-2 mb-2",
        message.role === "user" ? "justify-end" : "justify-start"
      )}
    >
      {message.role === "assistant" && (
        <div className="w-6 h-6 rounded-full bg-rose-300 flex items-center justify-center">
          <Bot size={16} />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2 border-neutral-200",
          message.role === "user"
            ? "bg-black text-white"
            : "bg-white border border-neutral-200"
        )}
      >
        <div
          className={cn(
            "text-sm leading-relaxed",
            message.role === "user" ? "text-white" : "prose prose-sm max-w-none"
          )}
        >
          {message.role === "user" ? (
            <span>{message.content}</span>
          ) : (
            <ReactMarkdown className="prose prose-sm [&>p]:last:mb-0">
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
      {message.role === "user" && (
        <div className="w-6 h-6 rounded-full text-white bg-black flex items-center justify-center">
          <User size={16} />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex w-full h-screen">
      {/* Chat Panel */}
      <div className="w-[50%] flex-shrink-0 flex flex-col h-full border-x">
        <div className="flex items-center justify-between flex-shrink-0 px-4 py-2 border-b bg-white sticky top-0 z-10">
          <h2 className="text-lg font-semibold">Chat</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAudioToggle}
            className="h-8 w-8 p-0"
            aria-label={isAudioEnabled ? "Disable audio" : "Enable audio"}
          >
            {isAudioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </Button>
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <div className="h-full overflow-y-auto">
            {messages
              ?.filter((message: any) => !message.isHidden)
              .map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>
        </div>
        <div className="flex-shrink-0">
          <CommandInput
            input={input}
            isLoading={isLoading}
            onInputChange={onInputChange}
            onSubmit={onSubmit}
            isOwner={isOwner}
          />
        </div>
      </div>

      {/* Tools Panel */}
      <div className="w-[50%] h-full flex-shrink-0 border-l bg-white overflow-hidden">
        <div className="h-full flex flex-col">
          <h2 className="flex-shrink-0 text-lg font-semibold p-4 border-b bg-white sticky top-0 z-10">
            Tools
          </h2>
          <div ref={toolsContentRef} className="flex-1 overflow-y-auto p-4">
            {toolInvocations.map((invocation) => (
              <ToolRenderer
                key={invocation.toolCallId}
                invocation={invocation}
                generatedImages={generatedImages}
                pendingImageRequests={pendingImageRequests}
                completedImages={completedImages}
                pendingVisualizations={pendingVisualizations}
                simulationCode={simulationCode}
                simulationCodeRef={simulationCodeRef}
                onSimulationCode={onSimulationCode}
                handleAnswerSubmit={handleAnswerSubmit}
                handleImageGeneration={handleImageGeneration}
                handleVisualization={handleVisualization}
                generatedQuizzes={generatedQuizzes}
                pendingQuizzes={pendingQuizzes}
                handleQuizGeneration={handleQuizGeneration}
                handleQuizAnswer={handleQuizAnswer}
                generatedVideos={generatedVideos}
                handleVideoComplete={handleVideoComplete}
                lastGeneratedImage={lastGeneratedImage}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};