import { useState, useEffect } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { api, resolveProductImageUrl } from '../../api';
import { useAuth } from '../../AuthContext';
import { useLoad, Loading, Notice, displayError } from '../../ui';
import type { SellerProductDraft, ProductCategory, ProductSubcategory, ProductTypeOption } from '../../types';
import { DAMOH_PRODUCT_TEMPLATES, type DamohProductTemplate } from './DamohProductTemplates';

function readSellerProductDraft(key: string): SellerProductDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function SellerCatalogueListingPage({
  onCancel,
  onSubmitted,
  onDraftSaved,
}: {
  onCancel: () => void;
  onSubmitted: () => void;
  onDraftSaved?: (draft: SellerProductDraft | null) => void;
}): ReactNode {
  const { user } = useAuth();
  const categories = useLoad(() => api.categories());
  const draftKey = `esakhi.seller.productDraft:${user?.id ?? 'seller'}`;
  const [draft] = useState(() => readSellerProductDraft(draftKey));
  const [categoryId, setCategoryId] = useState(draft?.categoryId ?? 'womens-apparel-accessories');
  const [subcategoryId, setSubcategoryId] = useState(draft?.subcategoryId ?? 'sarees-clothing');
  const [productType, setProductType] = useState(draft?.productType ?? '');
  const [name, setName] = useState(draft?.name ?? '');
  const [slug, setSlug] = useState(draft?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(draft?.slugEdited ?? false);
  const [description, setDescription] = useState(draft?.description ?? '');
  const [price, setPrice] = useState(draft?.price ?? '');
  const [stock, setStock] = useState(draft?.stock ?? '');
  const [lowStockThreshold, setLowStockThreshold] = useState(draft?.lowStockThreshold ?? '5');
  const [imageUrl, setImageUrl] = useState(draft?.imageUrl ?? '');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedCategory = categories.data?.find((c: ProductCategory) => c.categoryId === categoryId);
  const selectedSubcategory = selectedCategory?.subcategories.find((s: ProductSubcategory) => s.subcategoryId === subcategoryId);
  const slugFromName = (val: string) =>
    val
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  useEffect(() => {
    if (!categories.data?.length) return;
    const validCategory = categories.data.find((c: ProductCategory) => c.categoryId === categoryId) ?? categories.data[0];
    if (validCategory.categoryId !== categoryId) setCategoryId(validCategory.categoryId);
    if (!validCategory.subcategories.some((s: ProductSubcategory) => s.subcategoryId === subcategoryId)) {
      setSubcategoryId(validCategory.subcategories[0]?.subcategoryId ?? '');
    }
  }, [categories.data, categoryId, subcategoryId]);

  const currentDraft: SellerProductDraft = {
    categoryId,
    subcategoryId,
    productType,
    name,
    slug,
    slugEdited,
    description,
    price,
    stock,
    lowStockThreshold,
    imageUrl,
  };

  const applyTemplate = (tpl: DamohProductTemplate) => {
    setCategoryId(tpl.categoryId);
    setSubcategoryId(tpl.subcategoryId);
    setProductType(tpl.productType);
    setName(tpl.name);
    setSlug(slugFromName(tpl.name));
    setSlugEdited(true);
    setDescription(tpl.description);
    setPrice(String(tpl.defaultPrice));
    setStock(String(tpl.defaultStock));
    setLowStockThreshold(String(tpl.lowStockThreshold));
    setSaved(`✓ Loaded preset: "${tpl.shortLabel}". You can adjust price or stock before submitting.`);
    setTimeout(() => setSaved(''), 5000);
  };

  const saveDraft = (): void => {
    setError('');
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(currentDraft));
      onDraftSaved?.(currentDraft);
      setSaved('Draft saved on this device. It will be available when you return.');
    } catch (cause) {
      setError(displayError(cause));
    }
  };

  const uploadImage = async (file: File): Promise<void> => {
    setUploadingImage(true);
    setError('');
    setSaved('');
    try {
      const uploaded = await api.uploadSellerProductImage(file);
      setImageUrl(uploaded.imageUrl);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setUploadingImage(false);
    }
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSaved('');
    try {
      await api.createSellerProduct({
        name: name.trim(),
        slug: slug.trim() || slugFromName(name),
        description: description.trim(),
        categoryId,
        subcategoryId,
        productType: productType.trim(),
        pricePaise: Math.round(Number(price) * 100),
        stock: Number(stock),
        lowStockThreshold: Number(lowStockThreshold),
        ...(imageUrl.trim() ? { imageUrls: [imageUrl.trim()] } : {}),
      });
      setSaved('Your product has been submitted for City Admin review.');
      try {
        window.localStorage.removeItem(draftKey);
        onDraftSaved?.(null);
      } catch (cause) {
        console.warn('Could not remove seller product draft.', cause);
      }
      onSubmitted();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="seller-panel seller-product-editor" style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1.5px solid #e2e8f0' }}>
      <div className="seller-panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#0f172a' }}>Add New Product Listing</h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.84rem', color: '#64748b' }}>
            New listings are reviewed by Damoh City Admin and published to the marketplace.
          </p>
        </div>
        <button className="seller-secondary-action" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {/* 1-Tap Damoh Artisan Listing Presets Hero */}
      <div
        style={{
          marginBottom: '1.5rem',
          padding: '1.25rem',
          background: 'linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)',
          border: '1.5px solid #e879f9',
          borderRadius: '14px',
          boxShadow: '0 4px 12px rgba(192, 38, 211, 0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
          <span style={{ fontSize: '1.25rem' }}>✨</span>
          <div>
            <strong style={{ color: '#701a75', fontSize: '0.94rem' }}>
              1-Tap Damoh Craft Templates
            </strong>
            <div style={{ fontSize: '0.78rem', color: '#86198f' }}>
              Quick presets: Click any craft below to instantly pre-fill category, product details, and suggested price:
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
          {DAMOH_PRODUCT_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                padding: '0.48rem 0.95rem',
                borderRadius: '999px',
                background: '#ffffff',
                color: '#701a75',
                border: '1.5px solid #d946ef',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 2px 6px rgba(112, 26, 117, 0.08)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#701a75';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.color = '#701a75';
              }}
            >
              <span>{tpl.badge.split(' ')[0]}</span>
              <span>{tpl.shortLabel}</span>
              <span style={{ opacity: 0.75, fontSize: '0.74rem' }}>(₹{tpl.defaultPrice})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="seller-product-editor-body">
        {saved && <Notice tone="success">{saved}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {categories.error && (
          <div className="seller-panel-state">
            <Notice tone="error">{categories.error}</Notice>
            <button type="button" className="seller-secondary-action" onClick={() => void categories.reload()}>
              Retry categories
            </button>
          </div>
        )}

        <form className="seller-product-form" onSubmit={(e) => void submitProduct(e)}>
          <div className="form-grid two-up">
            <label className="field">
              <span>Main Category</span>
              <select
                required
                disabled={categories.loading || !categories.data?.length}
                value={categoryId}
                onChange={(event) => {
                  const nextCategory = categories.data?.find((category: ProductCategory) => category.categoryId === event.target.value);
                  setCategoryId(event.target.value);
                  setSubcategoryId(nextCategory?.subcategories[0]?.subcategoryId ?? '');
                  setProductType('');
                }}
              >
                {(categories.data ?? []).map((category: ProductCategory) => (
                  <option key={category.categoryId} value={category.categoryId}>
                    {category.categoryName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Subcategory</span>
              <select
                required
                disabled={!selectedCategory}
                value={subcategoryId}
                onChange={(event) => {
                  setSubcategoryId(event.target.value);
                  setProductType('');
                }}
              >
                {(selectedCategory?.subcategories ?? []).map((subcategory: ProductSubcategory) => (
                  <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>
                    {subcategory.subcategoryName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Product Type</span>
            <input
              required
              list="seller-product-types"
              value={productType}
              onChange={(event) => setProductType(event.target.value)}
              placeholder="e.g. Pickle, Saree, Diya, Herbal Soap"
            />
            <datalist id="seller-product-types">
              {(selectedSubcategory?.productTypes ?? []).map((type: ProductTypeOption) => (
                <option key={type.productTypeId} value={type.productType} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>Product Name</span>
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugEdited) setSlug(slugFromName(event.target.value));
              }}
            />
          </label>

          <label className="field">
            <span>Product URL Address (Slug)</span>
            <input
              required
              maxLength={180}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.target.value);
              }}
            />
            <small>Lowercase letters, numbers, and hyphens only.</small>
          </label>

          <label className="field">
            <span>Product Description</span>
            <textarea
              required
              minLength={1}
              maxLength={5000}
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <div className="seller-image-upload">
            <label className="field">
              <span>Product Image</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingImage}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file);
                  event.currentTarget.value = '';
                }}
              />
              <small>JPEG, PNG, or WebP. Maximum file size: 5 MB.</small>
            </label>
            {imageUrl && (
              <div className="seller-image-preview">
                <img src={resolveProductImageUrl(imageUrl)} alt="Product preview" />
                <div>
                  <strong>Image ready</strong>
                  <button type="button" className="seller-secondary-action" onClick={() => setImageUrl('')}>
                    Remove image
                  </button>
                </div>
              </div>
            )}
            {uploadingImage && <Loading label="Uploading product image…" />}
          </div>

          <div className="form-grid two-up">
            <label className="field">
              <span>Price (₹)</span>
              <input
                required
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Initial Available Stock</span>
              <input
                required
                type="number"
                min="0"
                max="100000"
                step="1"
                value={stock}
                onChange={(event) => setStock(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Low-Stock Alert Threshold</span>
              <input
                required
                type="number"
                min="0"
                max="100000"
                step="1"
                value={lowStockThreshold}
                onChange={(event) => setLowStockThreshold(event.target.value)}
              />
              <small>Alert triggers when stock drops to or below this number.</small>
            </label>
          </div>

          {categoryId === 'food-items' && (
            <Notice>
              Food listings require verified FSSAI details. Listings remain unpublished until City Admin approval.
            </Notice>
          )}

          <div className="seller-product-form-actions" style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="seller-secondary-action"
              onClick={saveDraft}
              disabled={saving || uploadingImage}
            >
              Save Draft on Device
            </button>
            <button
              type="submit"
              className="seller-primary-action"
              disabled={saving || uploadingImage || categories.loading || !categories.data?.length}
              style={{ background: '#4A0E4E', color: '#ffffff', fontWeight: 800, padding: '0.65rem 1.4rem' }}
            >
              {saving ? 'Submitting…' : 'Submit for Approval'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
