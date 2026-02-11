/**
 * Contract AI Analysis Store
 * 
 * React Context-based store for managing AI analysis results and Q&A history.
 * Persists analysis results per contract so they remain available while navigating.
 */

'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { 
  ContractAnalysisResult, 
  ContractQuestionResult,
  analyzeContract as analyzeContractService,
  askContract as askContractService,
} from '@/lib/services/contract-ai';

// ============================================
// STORE TYPES
// ============================================

interface ContractAIState {
  // Data
  analyses: Record<string, ContractAnalysisResult>;
  questions: Record<string, ContractQuestionResult[]>;
  
  // Loading states
  isAnalyzing: Record<string, boolean>;
  isAsking: Record<string, boolean>;
  
  // Error states
  analysisErrors: Record<string, string | null>;
  askErrors: Record<string, string | null>;
}

interface ContractAIActions {
  // Analysis actions
  runAnalysis: (contractId: string) => Promise<ContractAnalysisResult | null>;
  getAnalysis: (contractId: string) => ContractAnalysisResult | null;
  clearAnalysis: (contractId: string) => void;
  
  // Question actions
  askQuestion: (contractId: string, question: string) => Promise<ContractQuestionResult | null>;
  getQuestions: (contractId: string) => ContractQuestionResult[];
  clearQuestions: (contractId: string) => void;
  
  // Utility actions
  clearAll: () => void;
  isContractAnalyzing: (contractId: string) => boolean;
  isContractAsking: (contractId: string) => boolean;
}

type ContractAIContextType = ContractAIState & ContractAIActions;

// ============================================
// INITIAL STATE
// ============================================

const initialState: ContractAIState = {
  analyses: {},
  questions: {},
  isAnalyzing: {},
  isAsking: {},
  analysisErrors: {},
  askErrors: {},
};

// ============================================
// CONTEXT
// ============================================

const ContractAIContext = createContext<ContractAIContextType | null>(null);

// ============================================
// PROVIDER COMPONENT
// ============================================

interface ContractAIProviderProps {
  children: ReactNode;
}

export function ContractAIProvider({ children }: ContractAIProviderProps) {
  const [state, setState] = useState<ContractAIState>(initialState);

  // ========================================
  // ANALYSIS ACTIONS
  // ========================================

  const runAnalysis = useCallback(async (contractId: string): Promise<ContractAnalysisResult | null> => {
    // Set loading state
    setState((prev) => ({
      ...prev,
      isAnalyzing: { ...prev.isAnalyzing, [contractId]: true },
      analysisErrors: { ...prev.analysisErrors, [contractId]: null },
    }));

    try {
      // Call the AI service
      const result = await analyzeContractService(contractId);
      
      // Store the result
      setState((prev) => ({
        ...prev,
        analyses: { ...prev.analyses, [contractId]: result },
        isAnalyzing: { ...prev.isAnalyzing, [contractId]: false },
      }));

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro ao analisar contrato';
      
      setState((prev) => ({
        ...prev,
        isAnalyzing: { ...prev.isAnalyzing, [contractId]: false },
        analysisErrors: { ...prev.analysisErrors, [contractId]: errorMessage },
      }));

      return null;
    }
  }, []);

  const getAnalysis = useCallback((contractId: string): ContractAnalysisResult | null => {
    return state.analyses[contractId] || null;
  }, [state.analyses]);

  const clearAnalysis = useCallback((contractId: string) => {
    setState((prev) => {
      const { [contractId]: _, ...restAnalyses } = prev.analyses;
      const { [contractId]: __, ...restErrors } = prev.analysisErrors;
      return {
        ...prev,
        analyses: restAnalyses,
        analysisErrors: restErrors,
      };
    });
  }, []);

  // ========================================
  // QUESTION ACTIONS
  // ========================================

  const askQuestion = useCallback(async (contractId: string, question: string): Promise<ContractQuestionResult | null> => {
    // Set loading state
    setState((prev) => ({
      ...prev,
      isAsking: { ...prev.isAsking, [contractId]: true },
      askErrors: { ...prev.askErrors, [contractId]: null },
    }));

    try {
      // Call the AI service
      const result = await askContractService(contractId, question);
      
      // Add to questions history
      setState((prev) => ({
        ...prev,
        questions: {
          ...prev.questions,
          [contractId]: [...(prev.questions[contractId] || []), result],
        },
        isAsking: { ...prev.isAsking, [contractId]: false },
      }));

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro ao processar pergunta';
      
      setState((prev) => ({
        ...prev,
        isAsking: { ...prev.isAsking, [contractId]: false },
        askErrors: { ...prev.askErrors, [contractId]: errorMessage },
      }));

      return null;
    }
  }, []);

  const getQuestions = useCallback((contractId: string): ContractQuestionResult[] => {
    return state.questions[contractId] || [];
  }, [state.questions]);

  const clearQuestions = useCallback((contractId: string) => {
    setState((prev) => {
      const { [contractId]: _, ...restQuestions } = prev.questions;
      const { [contractId]: __, ...restErrors } = prev.askErrors;
      return {
        ...prev,
        questions: restQuestions,
        askErrors: restErrors,
      };
    });
  }, []);

  // ========================================
  // UTILITY ACTIONS
  // ========================================

  const clearAll = useCallback(() => {
    setState(initialState);
  }, []);

  const isContractAnalyzing = useCallback((contractId: string): boolean => {
    return state.isAnalyzing[contractId] || false;
  }, [state.isAnalyzing]);

  const isContractAsking = useCallback((contractId: string): boolean => {
    return state.isAsking[contractId] || false;
  }, [state.isAsking]);

  const value: ContractAIContextType = {
    ...state,
    runAnalysis,
    getAnalysis,
    clearAnalysis,
    askQuestion,
    getQuestions,
    clearQuestions,
    clearAll,
    isContractAnalyzing,
    isContractAsking,
  };

  return (
    <ContractAIContext.Provider value={value}>
      {children}
    </ContractAIContext.Provider>
  );
}

// ============================================
// HOOK
// ============================================

export function useContractAIStore(): ContractAIContextType {
  const context = useContext(ContractAIContext);
  if (!context) {
    throw new Error('useContractAIStore must be used within a ContractAIProvider');
  }
  return context;
}

// ============================================
// SELECTOR HOOKS
// ============================================

/**
 * Hook to get analysis for a specific contract
 */
export function useContractAnalysis(contractId: string | null): ContractAnalysisResult | null {
  const { analyses } = useContractAIStore();
  if (!contractId) return null;
  return analyses[contractId] ?? null;
}

/**
 * Hook to get questions for a specific contract
 */
export function useContractQuestions(contractId: string | null): ContractQuestionResult[] {
  const { questions } = useContractAIStore();
  if (!contractId) return [];
  return questions[contractId] ?? [];
}

/**
 * Hook to check if a contract is being analyzed
 */
export function useIsAnalyzing(contractId: string | null): boolean {
  const { isAnalyzing } = useContractAIStore();
  if (!contractId) return false;
  return isAnalyzing[contractId] ?? false;
}

/**
 * Hook to check if a question is being processed
 */
export function useIsAsking(contractId: string | null): boolean {
  const { isAsking } = useContractAIStore();
  if (!contractId) return false;
  return isAsking[contractId] ?? false;
}
