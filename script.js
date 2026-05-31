const DB_NAME = "wander-wellbeing-blog";
const STORE_NAME = "posts";
const DB_VERSION = 1;
const POSTS_API = "/.netlify/functions/posts";
const staticPosts = Array.isArray(window.BLOG_POSTS) ? window.BLOG_POSTS : [];

const form = document.querySelector("#postForm");
const postIdInput = document.querySelector("#postId");
const titleInput = document.querySelector("#postTitle");
const categoryInput = document.querySelector("#postCategory");
const contentInput = document.querySelector("#postContent");
const imageInput = document.querySelector("#postImages");
const imagePreview = document.querySelector("#imagePreview");
const postsList = document.querySelector("#postsList");
const postCount = document.querySelector("#postCount");
const clearFormButton = document.querySelector("#clearFormButton");
const emptyTemplate = document.querySelector("#emptyTemplate");
const saveStatus = document.querySelector("#saveStatus");
const isViewerPage = document.body.classList.contains("viewer-page");

let db;
let selectedImages = [];
let usingSharedStorage = true;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionStore(mode = "readonly") {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function getAllPosts() {
  if (isStaticHost()) return Promise.resolve(staticPosts);
  if (usingSharedStorage) return getSharedPosts();
  return new Promise((resolve, reject) => {
    const request = transactionStore().getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function savePost(post) {
  if (isStaticHost()) return saveLocalPost(post);
  if (usingSharedStorage) return saveSharedPost(post);
  return new Promise((resolve, reject) => {
    const request = transactionStore("readwrite").put(post);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deletePost(id) {
  if (isStaticHost()) return deleteLocalPost(id);
  if (usingSharedStorage) return deleteSharedPost(id);
  return new Promise((resolve, reject) => {
    const request = transactionStore("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function isStaticHost() {
  return location.hostname.endsWith("github.io");
}

function getLocalPosts() {
  return new Promise((resolve, reject) => {
    const request = transactionStore().getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveLocalPost(post) {
  return new Promise((resolve, reject) => {
    const request = transactionStore("readwrite").put(post);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteLocalPost(id) {
  return new Promise((resolve, reject) => {
    const request = transactionStore("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getSharedPosts() {
  const response = await fetch(POSTS_API, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load shared posts.");
  return response.json();
}

async function saveSharedPost(post) {
  const response = await fetch(POSTS_API, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(post)
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response));
  await saveLocalPost(post);
}

async function deleteSharedPost(id) {
  const response = await fetch(`${POSTS_API}?id=${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response));
  await deleteLocalPost(id);
}

async function getApiErrorMessage(response) {
  try {
    const body = await response.json();
    if (body.error === "usage_exceeded") {
      return "Netlify usage limit is reached. Saved on this browser only for now.";
    }
    return body.message || "Could not save this post online.";
  } catch {
    return "Could not save this post online.";
  }
}

async function migrateLocalPostsToSharedStorage() {
  if (isViewerPage || !usingSharedStorage) return;
  const [localPosts, sharedPosts] = await Promise.all([getLocalPosts(), getSharedPosts()]);
  const sharedIds = new Set(sharedPosts.map((post) => post.id));
  const missingPosts = localPosts.filter((post) => !sharedIds.has(post.id));

  for (const post of missingPosts) {
    await saveSharedPost(post);
  }
}

function filesToDataUrls(files) {
  return Promise.all(files.map(file => resizeImageFile(file)));
}

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1400;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        resolve({
          name: file.name,
          type: "image/jpeg",
          dataUrl: canvas.toDataURL("image/jpeg", 0.82)
        });
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function resetForm() {
  form.reset();
  postIdInput.value = "";
  selectedImages = [];
  imagePreview.innerHTML = "";
  form.querySelector(".save-button").textContent = "Save post";
}

function renderImagePreview() {
  imagePreview.innerHTML = selectedImages.map(image => (
    `<img src="${image.dataUrl}" alt="${image.name || "Uploaded blog picture"}">`
  )).join("");
}

function renderPosts(posts) {
  postsList.innerHTML = "";
  postCount.textContent = `${posts.length} ${posts.length === 1 ? "post" : "posts"}`;

  if (!posts.length) {
    postsList.append(emptyTemplate.content.cloneNode(true));
    return;
  }

  posts
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach(post => {
      const article = document.createElement("article");
      article.className = "post-card";
      article.innerHTML = `
        ${renderPostImages(post.images)}
        <div class="post-meta">
          <span class="category">${post.category}</span>
          <span>${formatDate(post.updatedAt)}</span>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <p class="post-body">${escapeHtml(post.content)}</p>
        ${renderPostActions(post.id)}
      `;
      postsList.append(article);
    });
}

function renderPostActions(id) {
  if (isViewerPage) return "";
  return `
    <div class="post-actions">
      <button type="button" data-action="edit" data-id="${id}">Edit</button>
      <button class="remove-button" type="button" data-action="remove" data-id="${id}">Remove</button>
    </div>
  `;
}

function renderPostImages(images = []) {
  if (!images.length) return "";
  return `
    <div class="post-images">
      ${images.map(image => `<img src="${image.dataUrl}" alt="${escapeHtml(image.name || "Blog picture")}">`).join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

async function refreshPosts() {
  const posts = isStaticHost() && !isViewerPage ? await getLocalPosts() : await getAllPosts();
  renderPosts(posts);
}

if (!isViewerPage) {
  imageInput.addEventListener("change", async event => {
    selectedImages = await filesToDataUrls([...event.target.files]);
    renderImagePreview();
  });

  clearFormButton.addEventListener("click", resetForm);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    saveStatus.textContent = "Saving...";

    const now = new Date().toISOString();
    const id = postIdInput.value || crypto.randomUUID();
    const existingPosts = await getAllPosts();
    const existingPost = existingPosts.find(post => post.id === id);
    const post = {
      id,
      title: titleInput.value.trim(),
      category: categoryInput.value,
      content: contentInput.value.trim(),
      images: selectedImages,
      createdAt: existingPost?.createdAt || now,
      updatedAt: now
    };

    try {
      await savePost(post);
      saveStatus.textContent = isStaticHost()
        ? "Saved in this browser. To publish publicly, add this post to posts.js and upload the image to assets."
        : "Saved online.";
    } catch (error) {
      await saveLocalPost(post);
      saveStatus.textContent = error.message;
    }

    resetForm();
    await refreshPosts();
  });

  postsList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const posts = await getAllPosts();
    const post = posts.find(item => item.id === id);
    if (!post) return;

    if (button.dataset.action === "remove") {
      await deletePost(id);
      if (postIdInput.value === id) resetForm();
      await refreshPosts();
    }

    if (button.dataset.action === "edit") {
      postIdInput.value = post.id;
      titleInput.value = post.title;
      categoryInput.value = post.category;
      contentInput.value = post.content;
      selectedImages = post.images || [];
      renderImagePreview();
      form.querySelector(".save-button").textContent = "Update post";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

openDatabase()
  .then(database => {
    db = database;
    return migrateLocalPostsToSharedStorage();
  })
  .catch(error => {
    usingSharedStorage = false;
    console.warn(error);
  })
  .then(() => {
    return refreshPosts();
  })
  .catch(error => {
    postsList.innerHTML = `<div class="empty-state"><h3>Storage unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
  });
