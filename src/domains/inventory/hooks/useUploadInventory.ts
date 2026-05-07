import { useCallback, useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { InventoryDetails, InventoryImage, MediaSource } from "../types";
import { INITIAL_DETAILS, MAX_IMAGES } from "../constants";
import { FieldKey } from "../components/ArtworkDetailsStep";
import { firestore } from "@/configs/firebase";
import { useAuth } from "@/domains/auth/contexts/AuthContext";
import { useProfileContext } from "@/domains/user/contexts/ProfileContext";
import { uploadIfLocal } from "@/shared/services/uploadService";

const DEFAULT_UPLOAD_FOLDER = "Unsorted";

export function useUploadInventory() {
  const navigation = useNavigation<any>();
  const { currentUser } = useAuth();
  const { profile } = useProfileContext();
  const [step, setStep] = useState(0);
  const [images, setImages] = useState<InventoryImage[]>([]);
  const [details, setDetails] = useState<InventoryDetails>(INITIAL_DETAILS);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [scrollToError, setScrollToError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("Submitting...");

  // Computed states
  const canContinue = images.length > 0;
  const canSubmit = useMemo(
    () => details.title.trim().length > 0 && images.length > 0,
    [details.title, images.length]
  );

  const validateDetails = useCallback(() => {
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    const require = (cond: boolean, key: FieldKey, message: string) => {
      if (!cond) nextErrors[key] = message;
    };

    require(details.title.trim().length > 0, "title", "Please enter a title.");
    require(details.description.trim().length > 0, "description", "Please add a description.");
    require(details.year.trim().length > 0, "year", "Year is required.");
    require(details.edition.trim().length > 0, "edition", "Edition is required.");
    const dimsMissing =
      !details.dimensions.height.trim().length ||
      !details.dimensions.width.trim().length ||
      !details.dimensions.depth.trim().length;
    if (dimsMissing) {
      nextErrors["dimensions.height"] = "Dimensions are required.";
    }
    require(details.weight.value.trim().length > 0, "weight.value", "Weight is required.");
    require(details.materials.trim().length > 0, "materials", "Materials are required.");
    require(details.price.trim().length > 0, "price", "Price is required.");
    require(details.quantity.trim().length > 0, "quantity", "Quantity is required.");

    return nextErrors;
  }, [details]);

  const clearFieldError = useCallback((key: FieldKey) => {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // --- Logic for Image Picking ---
  const chooseSource = useCallback(async (): Promise<MediaSource | null> => {
    if (Platform.OS === "ios") {
      return new Promise((resolve) => {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Camera", "Photo Library", "Cancel"],
            cancelButtonIndex: 2,
          },
          (buttonIndex) => {
            if (buttonIndex === 0) return resolve("camera");
            if (buttonIndex === 1) return resolve("library");
            resolve(null);
          }
        );
      });
    }

    return new Promise((resolve) => {
      Alert.alert("Choose source", "", [
        { text: "Camera", onPress: () => resolve("camera") },
        { text: "Photo Library", onPress: () => resolve("library") },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ]);
    });
  }, []);

  const ensurePermission = useCallback(async (source: MediaSource) => {
    if (source === "library") {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to continue."
        );
        return false;
      }
      return true;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow access to your camera to continue."
      );
      return false;
    }
    return true;
  }, []);

  const handlePickImages = useCallback(async () => {
    const source = await chooseSource();
    if (!source) return;

    const hasPermission = await ensurePermission(source);
    if (!hasPermission) return;

    const remainingSlots = Math.max(MAX_IMAGES - images.length, 1);
    const pickerResult =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.6,
            exif: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            selectionLimit: remainingSlots,
            quality: 0.6,
            exif: false,
          });

    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const newImages = pickerResult.assets.map((asset) => ({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
    }));

    setImages((prev) => {
      const nextImages = [...prev, ...newImages];
      if (nextImages.length > MAX_IMAGES) {
        Alert.alert(
          "Limit reached",
          `You can upload up to ${MAX_IMAGES} images.`
        );
      }
      return nextImages.slice(0, MAX_IMAGES);
    });
  }, [chooseSource, ensurePermission, images.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  // --- Logic for Navigation & Reset ---
  const resetForm = useCallback(() => {
    setStep(0);
    setImages([]);
    setDetails(INITIAL_DETAILS);
    setSelectedTags([]);
    setErrors({});
    setScrollToError(false);
  }, []);

  const goToPreviousTab = useCallback(() => {
    // Basic navigation back logic
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("Home");
    }
  }, [navigation]);

  const handleCancel = useCallback(() => {
    if (!images.length) {
      goToPreviousTab();
      return;
    }
    setShowExitConfirm(true);
  }, [goToPreviousTab, images.length]);

  const handleNextFromDetails = useCallback(() => {
    const validation = validateDetails();
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      setStep(1);
      setScrollToError(true);
      return false;
    }
    setErrors({});
    setScrollToError(false);
    setStep(2);
    return true;
  }, [validateDetails]);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    const validation = validateDetails();
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      setStep(1);
      setScrollToError(true);
      return;
    }
    if (!currentUser) {
      Alert.alert("Sign in required", "Please sign in to upload artwork.");
      return;
    }
    if (submitting) return;
    setErrors({});
    setScrollToError(false);
    setSubmitMessage("Preparing upload...");
    setSubmitting(true);

    const yearNumber = parseInt(details.year, 10);
    const editionNumber = parseInt(details.edition, 10);
    const height = parseFloat(details.dimensions.height);
    const width = parseFloat(details.dimensions.width);
    const depth = parseFloat(details.dimensions.depth);
    const weightValue = parseFloat(details.weight.value);
    const authorName =
      profile.user.name ||
      currentUser.displayName ||
      currentUser.email ||
      "Unknown Artist";
    const authorAvatar = profile.user.avatarUri || currentUser.photoURL || "";

    try {
      let uploadedCount = 0;
      setSubmitMessage(`Uploading images 0/${images.length}`);
      const uploadedImages = await Promise.all(
        images.map(async (img) => {
          const uploadedUri = (await uploadIfLocal(img.uri, "artworks")) || img.uri;
          uploadedCount += 1;
          setSubmitMessage(`Uploading images ${uploadedCount}/${images.length}`);
          return uploadedUri;
        })
      );

      setSubmitMessage("Saving artwork...");
      const uploadedAuthorAvatar =
        (await uploadIfLocal(authorAvatar, "avatars")) || authorAvatar;

      const artistSnapshot = {
        name: authorName,
        avatar: uploadedAuthorAvatar,
        verified: false,
      };

      await Promise.all([
        setDoc(
          doc(firestore, "artists", currentUser.uid),
          artistSnapshot,
          { merge: true }
        ),
        addDoc(collection(firestore, "artworks"), {
          authorId: currentUser.uid,
          authorName,
          artistId: currentUser.uid,
          artist: {
            ...artistSnapshot,
          },
          title: details.title || "Untitled",
          description: details.description || "",
          year: Number.isFinite(yearNumber) ? yearNumber : new Date().getFullYear(),
          edition: Number.isFinite(editionNumber) ? editionNumber : 1,
          materials: details.materials || "",
          price: details.price ? `USD $${details.price}` : "Price on Request",
          availabilityNote: "",
          images: uploadedImages,
          tags: selectedTags,
          dimension: {
            h: Number.isFinite(height) ? height : 0,
            w: Number.isFinite(width) ? width : 0,
            d: Number.isFinite(depth) ? depth : 0,
            unit: details.dimensions.unit,
          },
          weight: Number.isFinite(weightValue)
            ? `${weightValue} ${details.weight.unit}`
            : "0",
          shipping: [{ title: "Shipped within 7 working days in a box" }],
          stats: { worksSold: 0, buyers: 0 },
          metrics: { views: 0, likes: 0, shares: 0 },
          popularityScore: 0,
          status: details.status,
          folder: DEFAULT_UPLOAD_FOLDER,
          createdAt: serverTimestamp(),
        }),
      ]);

      navigation.navigate("Tabs", {
        screen: "Home",
        params: {
          screen: "Inventory",
        },
      });
      resetForm();
    } catch (error) {
      console.error("Failed to upload artwork:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not upload artwork. Please try again.";
      Alert.alert("Upload failed", message);
    } finally {
      setSubmitting(false);
      setSubmitMessage("Submitting...");
    }
  }, [
    validateDetails,
    details,
    images,
    navigation,
    selectedTags,
    currentUser,
    profile.user.name,
    profile.user.avatarUri,
    submitting,
    resetForm,
  ]);

  return {
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
    setErrors,
    clearFieldError,
    scrollToError,
    setScrollToError,
    selectedTags,
    handleToggleTag,
    submitting,
    submitMessage,
  };
}
