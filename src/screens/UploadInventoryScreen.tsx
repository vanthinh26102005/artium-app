import React, { useCallback, useEffect, useRef } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { useTabBarVisibility } from "../app/navigation/TabBarVisibilityContext";
import { useUploadInventory } from "../domains/inventory/hooks/useUploadInventory";
import { StepIndicator } from "../domains/inventory/components/ui/StepIndicator";
import { UploadImagesStep } from "../domains/inventory/components/UploadImagesStep";
import { ArtworkDetailsStep, FieldKey } from "../domains/inventory/components/ArtworkDetailsStep";
import { TagsStep } from "../domains/inventory/components/TagsStep";
import { STEPS } from "../domains/inventory/constants";

export default function UploadInventoryScreen() {
  const insets = useSafeAreaInsets();
  const { setHidden } = useTabBarVisibility();

  const {
    step,
    setStep,
    images,
    details,
    setDetails,
    showExitConfirm,
    setShowExitConfirm,
    canContinue,
    canSubmit,
    handlePickImages,
    handleRemoveImage,
    handleCancel,
    handleNextFromDetails,
    handleSubmit,
    resetForm,
    goToPreviousTab,
    errors,
    clearFieldError,
    scrollToError,
    setScrollToError,
    selectedTags,
    handleToggleTag,
    submitting,
    submitMessage,
  } = useUploadInventory();

  // Separate refs for different scroll views
  const scrollRef = useRef<ScrollView>(null);
  const keyboardScrollRef = useRef<any>(null);
  const tagsScrollRef = useRef<ScrollView>(null);
  const fieldPositions = useRef<Record<FieldKey, number>>({} as any);
  const prevStep = useRef(step);

  // Hide tab bar when this screen is focused
  useFocusEffect(
    useCallback(() => {
      setHidden(true);

      // Scroll to top when screen is focused
      scrollRef.current?.scrollTo({ y: 0, animated: false });

      return () => setHidden(false);
    }, [setHidden])
  );

  // Scroll to top when step changes
  useEffect(() => {
    if (prevStep.current !== step) {
      // Use setTimeout to ensure the scroll view is rendered
      setTimeout(() => {
        if (step === 0) {
          scrollRef.current?.scrollTo({ y: 0, animated: false });
        } else if (step === 1) {
          keyboardScrollRef.current?.scrollToPosition?.(0, 0, false);
        } else if (step === 2) {
          // Important: Scroll to top for Tags step (step 3)
          tagsScrollRef.current?.scrollTo({ y: 0, animated: false });
        }
      }, 50);
      prevStep.current = step;
    }
  }, [step]);

  useEffect(() => {
    if (!scrollToError || !errors || !keyboardScrollRef.current) return;
    const firstKey = Object.keys(errors)[0] as FieldKey | undefined;
    if (firstKey) {
      const y = fieldPositions.current[firstKey];
      if (typeof y === "number") {
        keyboardScrollRef.current.scrollToPosition(0, Math.max(y - 20, 0), true);
      }
    }
    setScrollToError(false);
  }, [errors, scrollToError, setScrollToError]);

  // Render content based on step
  const renderContent = () => {
    if (step === 0) {
      return (
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{
            paddingBottom: 20 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <UploadImagesStep
            images={images}
            onPickImages={handlePickImages}
            onRemoveImage={handleRemoveImage}
          />
        </ScrollView>
      );
    }

    if (step === 1) {
      return (
        <KeyboardAwareScrollView
          ref={keyboardScrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: 20 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          enableOnAndroid={true}
          enableAutomaticScroll={true}
          extraScrollHeight={Platform.OS === "ios" ? 120 : 80}
          extraHeight={Platform.OS === "ios" ? 150 : 100}
          keyboardOpeningTime={0}
        >
          <ArtworkDetailsStep
            details={details}
            onChangeDetails={setDetails}
            errors={errors}
            onFieldLayout={(key, y) => {
              fieldPositions.current[key] = y;
            }}
            onFieldChange={(key) => {
              if (errors?.[key]) {
                clearFieldError(key);
              }
            }}
          />
        </KeyboardAwareScrollView>
      );
    }

    // Step 2 (Tags step)
    return (
      <ScrollView
        ref={tagsScrollRef}
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: 20 + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TagsStep
          selectedTags={selectedTags}
          onToggleTag={handleToggleTag}
        />
      </ScrollView>
    );
  };

  return (
    <View className="flex-1 bg-[#F8FAFC]">
      <View
        className="px-6 pb-2 items-center"
        style={{ paddingTop: Math.max(insets.top, 24) }}
      >
        <Text className="text-2xl font-semibold text-slate-900 text-center">
          Upload Artwork
        </Text>
        <Text className="text-sm text-slate-500 mt-1 text-center">
          Add images and details to your inventory listing.
        </Text>
      </View>

      <StepIndicator step={step} steps={STEPS} />

      {renderContent()}

      {/* Footer Actions */}
      <View
        className="border-t border-slate-200 bg-white px-6 pt-4"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className="flex-row items-center gap-3">
          {step === 0 ? (
            <Pressable
              onPress={handleCancel}
              className="flex-1 rounded-full border border-slate-200 py-3 items-center active:opacity-80"
            >
              <Text className="text-sm font-semibold text-slate-600">
                Cancel
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setStep((prev) => Math.max(prev - 1, 0))}
              className="flex-1 rounded-full border border-slate-200 py-3 items-center active:opacity-80"
            >
              <Text className="text-sm font-semibold text-slate-600">
                Previous
              </Text>
            </Pressable>
          )}

          {step === 0 ? (
            <Pressable
              onPress={() => setStep(1)}
              disabled={!canContinue}
              className={`flex-1 rounded-full py-3 items-center ${canContinue ? "bg-[#0B73FF]" : "bg-slate-200"
                }`}
            >
              <Text
                className={`text-sm font-semibold ${canContinue ? "text-white" : "text-slate-500"
                  }`}
              >
                Continue
              </Text>
            </Pressable>
          ) : step === 1 ? (
            <Pressable
              onPress={handleNextFromDetails}
              className="flex-1 rounded-full py-3 items-center bg-[#0B73FF]"
            >
              <Text className="text-sm font-semibold text-white">Next</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
              className={`flex-1 rounded-full py-3 items-center ${canSubmit && !submitting ? "bg-[#0B73FF]" : "bg-slate-200"
                }`}
            >
              {submitting ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#64748B" />
                  <Text className="text-sm font-semibold text-slate-500">
                    {submitMessage}
                  </Text>
                </View>
              ) : (
                <Text
                  className={`text-sm font-semibold ${canSubmit ? "text-white" : "text-slate-500"
                    }`}
                >
                  Submit
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </View>

      {/* Exit Confirmation Modal */}
      <Modal
        visible={showExitConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExitConfirm(false)}
      >
        <View className="flex-1 bg-black/40 items-center justify-center px-6">
          <View className="w-full rounded-[28px] bg-white p-6">
            <View className="flex-row justify-end">
              <Pressable
                onPress={() => setShowExitConfirm(false)}
                hitSlop={12}
                className="h-10 w-10 items-center justify-center rounded-full"
              >
                <Ionicons name="close" size={22} color="#0F172A" />
              </Pressable>
            </View>

            <View className="mt-2 mb-5">
              <Text className="text-2xl font-bold text-slate-900 text-center">
                Are you sure{"\n"}you want to exit?
              </Text>
              <Text className="mt-3 text-base text-slate-500 text-center">
                All your process will be lost if you exit the uploading process now.
              </Text>
            </View>

            <View className="gap-3">
              <Pressable
                onPress={() => {
                  setShowExitConfirm(false);
                  resetForm();
                  goToPreviousTab();
                }}
                className="rounded-full border border-rose-500 py-3 items-center active:opacity-80"
              >
                <Text className="text-base font-semibold text-rose-500">
                  Exit uploading
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowExitConfirm(false)}
                className="rounded-full border border-slate-200 py-3 items-center active:opacity-80"
              >
                <Text className="text-base font-semibold text-slate-700">
                  Continue uploading
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
