import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { NextResponse } from 'next/server'
import { z } from 'zod'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable')
}

const TOOL_ROUTES = {
  presentation: '/tools/presentation',
  'lesson-planner': '/tools/lesson-planner',
  'comic-generator': '/tools/comic-generator',
  'chat-with-docs': '/tools/chat-with-docs',
  'image-generator': '/tools/image-generator',
  'video-generator': '/tools/video-generator',
  'text-tools': '/tools/text-tools',
  'mcq-generator': '/tools/mcq-generator',
  'youtube-assistant': '/tools/youtube-assistant',
  'audiobot': '/tools/audiobot',
  'personalized-lessons': '/tools/personalized-lessons',
  'research-assistant': '/tools/research-assistant',
  'study-planner': '/tools/study-planner',
  'evaluator': '/tools/evaluator',
  'project-helper': '/tools/project-helper',
  'individualized-education-planner': '/tools/individualized-education-planner',
  'marketing-content-generator': '/tools/marketing-content-generator',
  'report-generator': '/tools/report-generator',
  'school-intelligence': '/tools/school-intelligence',
}

const tools: Record<string, { description: string; parameters: z.ZodType<any> }> = Object.entries(TOOL_ROUTES).reduce((acc, [key, value]) => {
  acc[key] = {
    description: `Redirects user to ${key.replace('-', ' ')} tool`,
    parameters: z.object({}).describe('No parameters needed'),
  }
  return acc
}, {} as Record<string, { description: string; parameters: z.ZodType<any> }>)

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    interface ToolCall {
      name: string;
      arguments: any;
      id: string;
    }

    interface StreamTextOptions {
      model: string;
      messages: any[];
      system: string;
      tools: Record<string, { description: string; parameters: z.ZodType<any> }>;
      onToolCall: (toolCall: ToolCall) => Promise<{ redirect: string } | {}>;
    }

    const result: ReturnType<typeof streamText> = streamText({
      model: openai('gpt-4o'),
      messages,
      system: `You are a helpful assistant that can redirect users to various educational tools based on their requests. 
      When users mention or ask about any of the following tools, use the appropriate tool to redirect them:
      
      - Presentation
      - Lesson Planner
      - Comic Generator
      - Chat with Docs
      - Image Generator
      - Video Generator
      - Text Tools
      - MCQ Generator
      - YouTube Assistant
      - Audiobot
      - Personalized Lessons
      - Research Assistant
      - Study Planner
      - Evaluator
      - Project Helper
      - Individualized Education Planner
      - Marketing Content Generator
      - Report Generator
      - School Intelligence
      
      Always use the appropriate tool to redirect the user after providing a brief response about the tool's functionality.`,
      tools,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('Error in chat API:', error)
    return NextResponse.json(
      { error: 'An error occurred while processing your request.' },
      { status: 500 }
    )
  }
}

