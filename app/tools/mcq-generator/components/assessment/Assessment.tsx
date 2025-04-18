"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import MCQQuestion from "../questions/MCQQuestion";
import TrueFalseQuestion from "../questions/TrueFalseQuestion";
import FillInTheBlankQuestion from "../questions/FillInTheBlankQuestion";
import ShortQuestion from "../questions/ShortQuestion";
import MixedAssessmentQuestion from "../questions/MixedAssessmentQuestion";
import { downloadAssessment } from "@/utils/exportAssessment";
import { Download, Edit, Save, Upload } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/utils/supabase/client";

interface AssessmentProps {
  assessment: any[];
  assessmentType: string;
  onSubmit: (answers: any[]) => void;
  showResults: boolean;
  userAnswers: any[];
  assessmentId?: string;
  topic: string;
  readOnly?: boolean;
  hideSubmitButton?: boolean; // New prop to hide submit button
  isTeacher?: boolean; // New prop to check if user is a teacher
}

export default function Assessment({
  assessment,
  assessmentType,
  onSubmit,
  showResults,
  userAnswers,
  assessmentId,
  topic,
  readOnly = false,
  hideSubmitButton = false, // Default to false to maintain backward compatibility
  isTeacher = false, // Default to false assuming most users are students
}: AssessmentProps) {
  const [assessmentRecord, setAssessmentRecord] = useState<any>(null);
  const [answers, setAnswers] = useState<any[]>(
    userAnswers.length > 0
      ? userAnswers
      : new Array(assessment.length).fill(null)
  );
  const [localShowResults, setLocalShowResults] =
    useState<boolean>(showResults);
  const [editedAssessment, setEditedAssessment] = useState(assessment);
  const [uploadedImages, setUploadedImages] = useState<(string | null)[]>(
    new Array(assessment.length).fill(null)
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [explanation, setExplanation] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<string[]>([]);
  const [chatContext, setChatContext] = useState<string>("");
  const [shortAnswerScores, setShortAnswerScores] = useState<number[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [userIsTeacher, setUserIsTeacher] = useState<boolean>(isTeacher);

  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const autoSaveTimeoutRef = useRef<number | null>(null);

  const supabase = createClient();

  const transformObjectToArray = (
    optionsObject: Record<string, string>
  ): string[] => {
    return Object.keys(optionsObject)
      .sort()
      .map((key) => optionsObject[key]);
  };

  const indexToLetter = (index: number): string => {
    return String.fromCharCode(65 + index); // 65 is ASCII for 'A'
  };

  const letterToIndex = (letter: string): number => {
    return letter.toUpperCase().charCodeAt(0) - 65; // Convert 'A' to 0, 'B' to 1, etc.
  };

  useEffect(() => {
    if (assessmentId) {
      const fetchAssessmentRecord = async () => {
        try {
          const res = await fetch(
            `/api/generate-assessment/get-assessment?id=${assessmentId}`
          );
          if (!res.ok) {
            throw new Error("Failed to fetch assessment record");
          }
          const data = await res.json();
          setAssessmentRecord(data);

          let images: (string | null)[] = [];
          if (data.que_img_url) {
            try {
              images = JSON.parse(data.que_img_url);
            } catch (error) {
              console.error("Error parsing que_img_url:", error);
              images = new Array(data.questions.length).fill(null);
            }
          } else {
            images = new Array(data.questions.length).fill(null);
          }
          setUploadedImages(images);
          setEditedAssessment(data.questions);
          setAnswers(
            userAnswers.length > 0
              ? userAnswers
              : new Array(data.questions.length).fill(null)
          );
          fileInputRefs.current = data.questions.map(() => null);
        } catch (error) {
          console.error("Error fetching assessment record:", error);
        }
      };
      fetchAssessmentRecord();
    }
  }, [assessmentId, userAnswers]);

  useEffect(() => {
    if (!assessmentRecord) {
      setAnswers(
        Array.isArray(userAnswers) && userAnswers.length > 0
          ? userAnswers
          : new Array(assessment.length).fill(null)
      );
      setUploadedImages(new Array(assessment.length).fill(null));
      fileInputRefs.current = assessment.map(() => null);
      setEditedAssessment(assessment);
    }
  }, [assessment, userAnswers, assessmentRecord]);

  useEffect(() => {
    if (editedAssessment && editedAssessment.length > 0) {
      const newAssessment = editedAssessment.map((q: any) => {
        if (
          q.questionType?.trim().toLowerCase() === "mcq" &&
          q.options &&
          !Array.isArray(q.options)
        ) {
          return { ...q, options: transformObjectToArray(q.options) };
        }
        return q;
      });
      setEditedAssessment(newAssessment);
    }
  }, [assessment]);

  useEffect(() => {
    if (
      showResults &&
      (assessmentType === "shortanswer" || assessmentType === "mixedassessment")
    ) {
      evaluateShortAnswers();
    }
  }, [showResults, editedAssessment, answers, assessmentType]);

  useEffect(() => {
    setLocalShowResults(showResults);
  }, [showResults]);

  useEffect(() => {
    const checkUserRole = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          // Check if user has teacher role in metadata
          const userMetadata = user.user_metadata;
          const userRole = userMetadata?.role || "";

          if (
            userRole.toLowerCase() === "teacher" ||
            userRole.toLowerCase() === "admin"
          ) {
            setUserIsTeacher(true);
          }
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
      }
    };

    checkUserRole();
  }, [supabase]);

  const evaluateShortAnswers = async () => {
    try {
      const shortAnswerIndices = editedAssessment
        .map((q, i) => ({ ...q, index: i }))
        .filter((q) => {
          const type = q.questionType?.toLowerCase();
          return type === "shortanswer" || type === "short answer";
        });

      if (shortAnswerIndices.length === 0) {
        return;
      }

      const payload = shortAnswerIndices.map(
        ({ question, correctAnswer, answer, index }) => ({
          question: question,
          correctAnswer: correctAnswer ?? answer,
          userAnswer: answers[index] || "",
        })
      );

      const res = await fetch("/api/evaluate-short-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: payload,
          maxScorePerQuestion: 1,
        }),
      });
      const data = await res.json();

      if (data.scores && Array.isArray(data.scores)) {
        const newScores = new Array(editedAssessment.length).fill(0);
        shortAnswerIndices.forEach((item, i) => {
          newScores[item.index] = data.scores[i];
        });
        setShortAnswerScores(newScores);
      }
    } catch (error) {
      console.error("Error evaluating short answers:", error);
    }
  };

  const handleAnswerChange = (questionIndex: number, answer: any) => {
    if (readOnly) return;

    const newAnswers = [...answers];
    if (assessmentType === "mcq") {
      newAnswers[questionIndex] = typeof answer === "number" ? answer : null;
    } else {
      newAnswers[questionIndex] = answer;
    }
    setAnswers(newAnswers);

    if (assessmentId) {
      if (assessmentType === "shortanswer") {
        if (autoSaveTimeoutRef.current)
          clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = window.setTimeout(() => {
          fetch("/api/save-answer", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assessmentId,
              questionIndex,
              answer: newAnswers[questionIndex],
            }),
          }).catch((err) => console.error("Error saving answer:", err));
        }, 3000);
      } else {
        (async () => {
          try {
            await fetch("/api/save-answer", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                assessmentId,
                questionIndex,
                answer: newAnswers[questionIndex],
              }),
            });
          } catch (error) {
            console.error("Error saving answer:", error);
          }
        })();
      }
    }
  };

  const handleSubmit = async () => {
    if (readOnly) return;
    await onSubmit(answers);
    await handleSaveResults();
    setLocalShowResults(true);
  };

  const calculateScore = () => {
    if (!Array.isArray(answers)) {
      console.error("Answers is not an array:", answers);
      return 0;
    }

    return answers.reduce((score, answer, index) => {
      const question = editedAssessment[index];
      if (!question) return score;

      if (assessmentType !== "mixedassessment") {
        if (assessmentType === "mcq" && question.correctAnswer !== undefined) {
          return score + (answer === question.correctAnswer ? 1 : 0);
        } else if (
          assessmentType === "truefalse" &&
          question.correctAnswer !== undefined
        ) {
          return score + (answer === question.correctAnswer ? 1 : 0);
        } else if (assessmentType === "fillintheblank" && question.answer) {
          return (
            score +
            (answer?.toLowerCase() === question.answer.toLowerCase() ? 1 : 0)
          );
        } else if (assessmentType === "shortanswer") {
          return score + (shortAnswerScores[index] || 0);
        }

        return score;
      }

      const type = question.questionType?.toLowerCase();

      if (type === "mcq") {
        let correctIndex = 0;
        if (typeof question.correctAnswer === "string") {
          correctIndex =
            question.correctAnswer.toUpperCase().charCodeAt(0) -
            "A".charCodeAt(0);
        } else {
          correctIndex = question.correctAnswer;
        }
        return score + (answer === correctIndex ? 1 : 0);
      } else if (type === "truefalse" || type === "true/false") {
        return score + (answer === question.correctAnswer ? 1 : 0);
      } else if (type === "fillintheblank" || type === "fill in the blanks") {
        return (
          score +
          (answer?.toLowerCase() === question.answer?.toLowerCase() ? 1 : 0)
        );
      } else if (type === "shortanswer" || type === "short answer") {
        return score + (shortAnswerScores[index] || 0);
      }

      return score;
    }, 0);
  };

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    index: number
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      alert("Please upload only PNG or JPEG images");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const newUploadedImages = [...uploadedImages];
      newUploadedImages[index] = e.target?.result as string;
      setUploadedImages(newUploadedImages);
    };
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("index", index.toString());
    formData.append("num_questions", editedAssessment.length.toString());
    if (assessmentId) {
      formData.append("assessment_id", assessmentId);
    } else {
      alert("Assessment ID is missing!");
      return;
    }

    try {
      const response = await fetch(
        "/api/generate-assessment/que-image-upload",
        {
          method: "POST",
          body: formData,
        }
      );
      const contentType = response.headers.get("content-type");
      let data: any;
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("Unexpected response:", text);
        throw new Error("Response is not JSON");
      }
      if (response.ok && data.fileUrl) {
        const newUploadedImages = [...uploadedImages];
        newUploadedImages[index] = data.fileUrl;
        setUploadedImages(newUploadedImages);
      } else {
        console.error("Image upload failed:", data.error);
        alert("Image upload failed: " + (data.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      alert("Error uploading image");
    }
  };

  const triggerFileInput = (index: number) => {
    fileInputRefs.current[index]?.click();
  };

  const imageUploadComponent = (index: number) => (
    <div className="relative h-[220px] w-[220px] bg-white rounded-lg shadow-md overflow-hidden flex-shrink-0">
      {uploadedImages[index] ? (
        <img
          src={uploadedImages[index] || "/placeholder.svg"}
          alt={`Image for question ${index + 1}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <span className="text-gray-400">No image</span>
        </div>
      )}
      <button
        onClick={() => triggerFileInput(index)}
        className="absolute top-2 right-2 bg-white rounded-full p-1 shadow-md hover:bg-gray-100"
        aria-label={`Upload image for question ${index + 1}`}
      >
        <Upload className="h-4 w-4 text-gray-600" />
      </button>
      <input
        ref={(el) => (fileInputRefs.current[index] = el)}
        type="file"
        accept="image/png, image/jpeg"
        onChange={(e) => handleImageUpload(e, index)}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );

  const renderQuestion = (question: any, index: number) => {
    if (editMode) {
      return (
        <div key={index} className="border rounded-lg p-4 mb-4">
          <div className="flex gap-4 items-stretch">
            <div className="flex-[0.7]">
              <Textarea
                value={question.question}
                onChange={(e) => handleEdit(index, "question", e.target.value)}
                className="mb-2"
              />
              {(assessmentType === "mcq" ||
                (assessmentType === "mixedassessment" &&
                  question.questionType?.trim().toLowerCase() === "mcq")) && (
                <div>
                  {(() => {
                    const optionsArray = Array.isArray(question.options)
                      ? question.options
                      : question.options
                        ? transformObjectToArray(question.options)
                        : [];
                    return optionsArray.map(
                      (option: string, optionIndex: number) => (
                        <div
                          key={optionIndex}
                          className="flex items-center mb-1"
                        >
                          <span className="w-6 text-center font-medium mr-1">
                            {indexToLetter(optionIndex)}:
                          </span>
                          <Input
                            value={option}
                            onChange={(e) =>
                              handleOptionEdit(
                                index,
                                optionIndex,
                                e.target.value
                              )
                            }
                            className="flex-1"
                          />
                        </div>
                      )
                    );
                  })()}

                  <div className="mt-3 border-t pt-3">
                    <label className="block text-sm font-medium mb-1 text-rose-600">
                      Correct Answer:
                    </label>
                    <Select
                      value={
                        typeof question.correctAnswer === "number"
                          ? indexToLetter(question.correctAnswer)
                          : typeof question.correctAnswer === "string" &&
                              !isNaN(Number(question.correctAnswer))
                            ? indexToLetter(Number(question.correctAnswer))
                            : "A"
                      }
                      onValueChange={(letter) => {
                        const correctIndex = letterToIndex(letter);
                        handleEdit(index, "correctAnswer", correctIndex);
                      }}
                    >
                      <SelectTrigger className="max-w-[150px] border-rose-300">
                        <SelectValue placeholder="Select answer" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.isArray(question.options) &&
                          question.options.map(
                            (_: string, optionIndex: number) => (
                              <SelectItem
                                key={optionIndex}
                                value={indexToLetter(optionIndex)}
                              >
                                Option {indexToLetter(optionIndex)}
                              </SelectItem>
                            )
                          )}
                        {!Array.isArray(question.options) && (
                          <>
                            <SelectItem value="A">Option A</SelectItem>
                            <SelectItem value="B">Option B</SelectItem>
                            <SelectItem value="C">Option C</SelectItem>
                            <SelectItem value="D">Option D</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {(assessmentType === "truefalse" ||
                (assessmentType === "mixedassessment" &&
                  (question.questionType?.toLowerCase() === "truefalse" ||
                    question.questionType?.toLowerCase() ===
                      "true/false"))) && (
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1 text-rose-600">
                    Correct Answer:
                  </label>
                  <Select
                    value={question.correctAnswer?.toString() || "true"}
                    onValueChange={(value) =>
                      handleEdit(index, "correctAnswer", value === "true")
                    }
                  >
                    <SelectTrigger className="max-w-[150px] border-rose-300">
                      <SelectValue placeholder="Select answer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">True</SelectItem>
                      <SelectItem value="false">False</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(assessmentType === "fillintheblank" ||
                (assessmentType === "mixedassessment" &&
                  (question.questionType?.toLowerCase() === "fillintheblank" ||
                    question.questionType?.toLowerCase() ===
                      "fill in the blanks"))) && (
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1 text-rose-600">
                    Correct Answer:
                  </label>
                  <Input
                    value={question.answer || ""}
                    onChange={(e) =>
                      handleEdit(index, "answer", e.target.value)
                    }
                    className="border-rose-300"
                  />
                </div>
              )}
              {(assessmentType === "shortanswer" ||
                (assessmentType === "mixedassessment" &&
                  (question.questionType?.toLowerCase() === "shortanswer" ||
                    question.questionType?.toLowerCase() ===
                      "short answer"))) && (
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1 text-rose-600">
                    Model Answer (for grading):
                  </label>
                  <Textarea
                    value={question.answer || question.correctAnswer || ""}
                    onChange={(e) => {
                      handleEdit(index, "answer", e.target.value);
                      handleEdit(index, "correctAnswer", e.target.value);
                    }}
                    className="border-rose-300"
                  />
                </div>
              )}
            </div>
            {imageUploadComponent(index)}
          </div>
        </div>
      );
    } else {
      let questionComponent;
      switch (assessmentType) {
        case "mcq":
          questionComponent = (
            <MCQQuestion
              key={index}
              question={editedAssessment[index]}
              index={index}
              userAnswer={answers[index]}
              onChange={(answer) => handleAnswerChange(index, answer)}
              showResults={localShowResults || showResults}
            />
          );
          break;
        case "truefalse":
          questionComponent = (
            <TrueFalseQuestion
              key={index}
              question={editedAssessment[index]}
              index={index}
              userAnswer={answers[index]}
              onChange={(answer) => handleAnswerChange(index, answer)}
              showResults={localShowResults || showResults}
            />
          );
          break;
        case "fillintheblank":
          questionComponent = (
            <FillInTheBlankQuestion
              key={index}
              question={editedAssessment[index]}
              index={index}
              userAnswer={answers[index]}
              onChange={(answer) => handleAnswerChange(index, answer)}
              showResults={localShowResults || showResults}
            />
          );
          break;
        case "shortanswer":
          questionComponent = (
            <ShortQuestion
              key={index}
              question={editedAssessment[index]}
              index={index}
              userAnswer={answers[index]}
              onChange={(answer) => handleAnswerChange(index, answer)}
              showResults={localShowResults || showResults}
              evaluatedScore={shortAnswerScores[index]}
            />
          );
          break;
        case "mixedassessment":
          questionComponent = (
            <MixedAssessmentQuestion
              key={index}
              question={editedAssessment[index]}
              index={index}
              userAnswer={answers[index]}
              onChange={(answer) => handleAnswerChange(index, answer)}
              showResults={localShowResults || showResults}
              shortAnswerScore={shortAnswerScores[index]}
            />
          );
          break;
        default:
          questionComponent = null;
      }
      return (
        <div
          key={index}
          className="border rounded-lg p-4 mb-4 bg-white shadow-sm"
        >
          <div className="flex gap-4 items-stretch justify-between">
            <div className="flex-[0.8]">{questionComponent}</div>
            {uploadedImages[index] && (
              <div className="h-[220px] w-[220px] rounded-lg overflow-hidden shadow-md">
                <img
                  src={uploadedImages[index] || "/placeholder.svg"}
                  alt={`Image for question ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>
        </div>
      );
    }
  };

  const handleSaveResults = async () => {
    setIsSaving(true);
    setSaveError("");

    try {
      const response = await fetch("/api/generate-assessment", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: assessmentId,
          answers: answers,
          images: uploadedImages,
          submitted: true,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to save answers");
      }
      const data = await response.json();
      console.log("Answers saved successfully:", data);
    } catch (error) {
      console.error("Error saving answers:", error);
      setSaveError(
        `Failed to save answers: ${
          error instanceof Error ? error.message : "Unknown error occurred"
        }`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveEdits = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/generate-assessment", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: assessmentId,
          questions: editedAssessment,
          images: uploadedImages,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update assessment");
      }
      const data = await response.json();
      if (data.success) {
        setEditMode(false);
        setEditedAssessment(data.data[0].questions);
        setSaveError("");
        console.log("Assessment updated successfully:", data.data[0].questions);
      } else {
        throw new Error("Failed to update assessment");
      }
    } catch (error) {
      console.error("Error updating assessment:", error);
      setSaveError("Failed to update assessment. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const fetchSummaryExplanation = async (
    followUpMessage?: string
  ): Promise<void> => {
    try {
      if (followUpMessage) {
        setIsLoadingChat(true);
      } else {
        setIsLoadingAnalysis(true);
      }
      const payload: any = {
        assessment: editedAssessment,
        userAnswers: answers,
      };
      if (followUpMessage) {
        payload.message = followUpMessage;
      }
      const response = await fetch("/api/assessment-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.explanation) {
        if (followUpMessage) {
          setChatHistory((prev) => [
            ...prev,
            `You: ${followUpMessage}`,
            `Bot: ${data.explanation}`,
          ]);
        } else {
          setExplanation(data.explanation);
          setChatContext(data.explanation);
          setChatHistory([]);
        }
      }
    } catch (error) {
      console.error("Error fetching summary:", error);
    } finally {
      setIsLoadingChat(false);
      setIsLoadingAnalysis(false);
    }
  };

  const handleChatSubmit = async () => {
    if (chatInput.trim()) {
      await fetchSummaryExplanation(chatInput.trim());
      setChatInput("");
    }
  };

  const handleEdit = (index: number, field: string, value: any) => {
    const newAssessment = [...editedAssessment];
    newAssessment[index] = { ...newAssessment[index], [field]: value };
    setEditedAssessment(newAssessment);
  };

  const handleOptionEdit = (
    questionIndex: number,
    optionIndex: number,
    newValue: string
  ) => {
    setEditedAssessment((prev) => {
      const updated = [...prev];
      const questionCopy = { ...updated[questionIndex] };

      const currentOptions = Array.isArray(questionCopy.options)
        ? questionCopy.options
        : questionCopy.options
          ? transformObjectToArray(questionCopy.options)
          : [];

      const newOptions = [...currentOptions];
      newOptions[optionIndex] = newValue;
      questionCopy.options = newOptions;
      updated[questionIndex] = questionCopy;
      return updated;
    });
  };

  return (
    <div className="space-y-4 bg-[#f7f3f2] p-4 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <Button
          onClick={() =>
            downloadAssessment(
              editedAssessment,
              assessmentType,
              topic,
              "pdf",
              localShowResults || showResults
            )
          }
          className="bg-neutral-900 hover:bg-neutral-700"
        >
          <Download className="mr-2 h-4 w-4" />
          Download{" "}
          {localShowResults || showResults
            ? "PDF with Answers"
            : "Questions PDF"}
        </Button>

        {(isTeacher || userIsTeacher) && (
          <Button
            onClick={() => {
              if (editMode) {
                saveEdits();
              } else {
                setEditMode(true);
              }
            }}
            className="bg-black hover:bg-rose-500"
          >
            {editMode ? (
              <Save className="mr-2 h-4 w-4" />
            ) : (
              <Edit className="mr-2 h-4 w-4" />
            )}
            {editMode ? "Save Changes" : "Edit Questions"}
          </Button>
        )}
      </div>

      <div>
        {editedAssessment.map((question, index) =>
          renderQuestion(question, index)
        )}
        {editMode ? (
          <Button
            onClick={saveEdits}
            className="mt-4 bg-rose-600 hover:bg-rose-500"
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Edits"}
          </Button>
        ) : (
          !(localShowResults || showResults) &&
          !readOnly &&
          !hideSubmitButton && (
            <Button
              onClick={handleSubmit}
              className="w-full bg-rose-500 hover:bg-rose-600 text-white mt-6"
            >
              Submit Answers
            </Button>
          )
        )}
      </div>

      {(localShowResults || showResults) && !editMode && (
        <div className="text-center">
          <h2 className="text-2xl font-bold">
            Your Score: {calculateScore()} /{" "}
            {assessmentType === "shortanswer"
              ? editedAssessment.length * 5
              : editedAssessment.length}
          </h2>
          <div className="flex justify-center gap-2 mt-4">
            <Button
              onClick={() =>
                downloadAssessment(
                  editedAssessment,
                  assessmentType,
                  topic,
                  "pdf",
                  true
                )
              }
              className="bg-neutral-900 hover:bg-neutral-700"
            >
              <Download className="mr-2 h-4 w-4" />
              Download PDF with Answers
            </Button>
            <Button
              onClick={() => window.location.reload()}
              className="bg-neutral-900 hover:bg-neutral-700"
            >
              Start New Assessment
            </Button>
          </div>
          {saveError && <p className="text-red-600 mt-2">{saveError}</p>}
          <div className="mt-8 border-t pt-4">
          <Button
              onClick={() => fetchSummaryExplanation()}
              className="bg-rose-600 hover:bg-rose-500 text-white"
              disabled={isLoadingAnalysis}
            >
              {isLoadingAnalysis ? "Loading..." : "Get Analysis"}
            </Button>
            {explanation && (
              <div className="mt-4 p-4 border rounded bg-gray-50 text-left">
                <h3 className="font-semibold mb-2">Summary Explanation:</h3>
                <ReactMarkdown className="prose prose-sm leading-tight">
                  {explanation}
                </ReactMarkdown>
              </div>
            )}
            {chatHistory.length > 0 && (
              <div className="mt-4 p-4 border rounded bg-gray-50 text-left">
                <h3 className="font-semibold mb-2">Chat:</h3>
                <div className="space-y-2">
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className="p-2 rounded bg-white shadow-sm">
                      <ReactMarkdown className="prose prose-sm leading-tight">
                        {msg}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 flex space-x-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a follow-up question..."
                className="border rounded p-2 flex-grow"
                disabled={isLoadingChat}
              />
              <Button
                onClick={handleChatSubmit}
                className="bg-rose-600 hover:bg-rose-500 text-white"
                disabled={isLoadingChat}
              >
                {isLoadingChat ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
