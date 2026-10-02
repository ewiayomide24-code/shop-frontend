import { useState, useEffect } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'https://nexora-shop-backend.onrender.com'

// Wraps fetch for authenticated requests. On a 401 (expired/invalid token),
// it fires a global event so App can log the user out cleanly, instead of
// every screen silently failing or showing stale data.
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options)
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:expired'))
  }
  return res
}

async function postJson(path, body, token) {
  const res = await apiFetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

function App() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [view, setView] = useState('products')
  const [selectedProductId, setSelectedProductId] = useState(null)

  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })

  const [cart, setCart] = useState(null)
  const [wishlistIds, setWishlistIds] = useState([])
  const [wishlistItems, setWishlistItems] = useState([])

  const [selectedCategories, setSelectedCategories] = useState([])
  const [sortBy, setSortBy] = useState('popularity')
  const [search, setSearch] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [resetToken, setResetToken] = useState(null)

  function loadProducts() {
    setLoading(true)
    fetch(`${API_URL}/api/products?limit=100`)
      .then((res) => res.json())
      .then((data) => { setProducts(data.data); setLoading(false) })
      .catch(() => { setError('Could not load products. Is the backend running?'); setLoading(false) })
  }

  useEffect(() => {
    loadProducts()
    fetch(`${API_URL}/api/categories`).then((r) => r.json()).then(setCategories)
  }, [])

  function handleLogout() {
    setToken(null); setUser(null); setCart(null); setWishlistIds([]); setWishlistItems([])
    localStorage.removeItem('token'); localStorage.removeItem('user')
    setView('login')
  }

  // Global session-expired handler: any authenticated call that gets a 401
  // ends up here, so the user is logged out and told to sign in again
  // instead of every screen quietly breaking.
  useEffect(() => {
    function handleExpired() { handleLogout() }
    window.addEventListener('auth:expired', handleExpired)
    return () => window.removeEventListener('auth:expired', handleExpired)
  }, [])

  // Open the reset screen when someone arrives from an emailed link (?reset=TOKEN),
  // and show a confirmation/cancelled screen when returning from checkout
  // (?checkout=success or ?checkout=cancelled). Your payment provider's
  // success_url / cancel_url need to point back here with those params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('reset')
    const checkoutResult = params.get('checkout')

    if (t) {
      setResetToken(t); setView('reset')
    } else if (checkoutResult === 'success') {
      setView('order-success')
      window.history.replaceState({}, '', '/')
    } else if (checkoutResult === 'cancelled') {
      setView('order-cancelled')
      window.history.replaceState({}, '', '/')
    }
  }, [])

  useEffect(() => {
    if (token) { refreshCart(); refreshWishlist() } else { setCart(null); setWishlistIds([]); setWishlistItems([]) }
  }, [token])

  function refreshCart() {
    apiFetch(`${API_URL}/api/cart`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then(setCart)
      .catch(() => {})
  }

  function refreshWishlist() {
    apiFetch(`${API_URL}/api/wishlist`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => { setWishlistItems(data.items); setWishlistIds(data.items.map((p) => p.id)) })
      .catch(() => {})
  }

  async function toggleWishlist(productId) {
    if (!token) { setView('login'); return }
    if (wishlistIds.includes(productId)) {
      await apiFetch(`${API_URL}/api/wishlist/items/${productId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    } else {
      await apiFetch(`${API_URL}/api/wishlist/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId })
      })
    }
    refreshWishlist()
  }

  function handleAuthSuccess(data) {
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setView('products')
  }

  function openProduct(id) { setSelectedProductId(id); setView('product') }

  function toggleCategory(name) {
    setSelectedCategories((prev) => prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name])
  }

  function clearFilters() {
    setSearch(''); setMinPrice(''); setMaxPrice(''); setSelectedCategories([])
  }

  async function addToCart(productId, quantity = 1) {
    if (!token) { setView('login'); return }
    const res = await apiFetch(`${API_URL}/api/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId, quantity })
    })
    const data = await res.json()
    if (res.ok) setCart(data); else if (res.status !== 401) alert(data.error)
  }

  async function updateCartItem(productId, quantity) {
    const res = await apiFetch(`${API_URL}/api/cart/items/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ quantity })
    })
    const data = await res.json()
    if (res.ok) setCart(data); else if (res.status !== 401) alert(data.error)
  }

  async function removeCartItem(productId) {
    await apiFetch(`${API_URL}/api/cart/items/${productId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    refreshCart()
  }

  async function startCheckout(shippingAddress, couponCode) {
    const body = { shippingAddress }
    if (couponCode) body.couponCode = couponCode
    const res = await apiFetch(`${API_URL}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (!res.ok) { if (res.status !== 401) alert(data.error || 'Checkout failed'); return }
    window.location.href = data.checkoutUrl
  }

  const cartCount = cart ? cart.totalItems : 0
  const isAdmin = user && user.role === 'admin'

  let visibleProducts = products.filter((p) =>
    (!selectedCategories.length || selectedCategories.includes(p.category)) &&
    p.name.toLowerCase().includes(search.trim().toLowerCase()) &&
    (minPrice === '' || p.price >= Number(minPrice)) &&
    (maxPrice === '' || p.price <= Number(maxPrice))
  )
  visibleProducts = [...visibleProducts].sort((a, b) => {
    if (sortBy === 'price-asc') return a.price - b.price
    if (sortBy === 'price-desc') return b.price - a.price
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    return 0
  })

  const filtersActive = search || minPrice || maxPrice || selectedCategories.length > 0

  return (
    <div>
      <header className="app-header">
        <div className="logo-mark" onClick={() => setView('products')}>
          <span className="logo-text">shoply</span>
        </div>
        <nav className="nav">
          {token && <button className="nav-link" onClick={() => setView('wishlist')}>Wishlist ({wishlistIds.length})</button>}
          {token && <button className="nav-link" onClick={() => setView('cart')}>Cart ({cartCount})</button>}
          {token && <button className="nav-link" onClick={() => setView('orders')}>Orders</button>}
          {token && <button className="nav-link" onClick={() => setView('account')}>Account</button>}
          {isAdmin && <button className="nav-link" onClick={() => setView('admin')}>Admin</button>}
          {user ? (
            <>
              <span className="nav-text">{user.name}</span>
              <button className="nav-link" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <>
              <button className="nav-link" onClick={() => setView('login')}>Log in</button>
              <button className="nav-link" onClick={() => setView('register')}>Sign up</button>
            </>
          )}
        </nav>
      </header>

      <main className="page">
        {view === 'login' && <LoginForm onSuccess={handleAuthSuccess} onSwitch={() => setView('register')} onForgot={() => setView('forgot')} />}
        {view === 'register' && <RegisterForm onSuccess={handleAuthSuccess} onSwitch={() => setView('login')} />}
        {view === 'forgot' && <ForgotForm onBack={() => setView('login')} />}
        {view === 'reset' && (
          <ResetForm
            resetToken={resetToken}
            onDone={() => { window.history.replaceState({}, '', '/'); setResetToken(null); setView('login') }}
          />
        )}
        {view === 'account' && token && <ChangePasswordForm token={token} />}

        {view === 'order-success' && (
          <OrderSuccessView
            onViewOrders={() => setView(token ? 'orders' : 'login')}
            onContinue={() => setView('products')}
          />
        )}
        {view === 'order-cancelled' && (
          <OrderCancelledView onBackToCart={() => setView('cart')} onContinue={() => setView('products')} />
        )}

        {view === 'products' && (
          <div className="shop-layout">
            <aside className="filter-sidebar">
              <h3>Filter</h3>

              <div className="filter-group">
                <div className="filter-group-title">Search</div>
                <input
                  className="field"
                  style={{ marginBottom: 0 }}
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="filter-group">
                <div className="filter-group-title">Price</div>
                <div className="price-range-inputs">
                  <input type="number" min="0" placeholder="Min" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                  <span>–</span>
                  <input type="number" min="0" placeholder="Max" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-title">Category</div>
                {categories.map((c) => (
                  <label key={c.id} className="filter-checkbox">
                    <input type="checkbox" checked={selectedCategories.includes(c.name)} onChange={() => toggleCategory(c.name)} />
                    {c.name}
                  </label>
                ))}
              </div>

              {filtersActive && <button className="btn-text" onClick={clearFilters}>Clear filters</button>}
            </aside>

            <div>
              <div className="results-bar">
                <span className="results-count">{visibleProducts.length} product{visibleProducts.length !== 1 ? 's' : ''}</span>
                <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="popularity">Sort by popularity</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>

              {loading && <p>Loading products...</p>}
              {error && <p className="error-text">{error}</p>}
              {!loading && !error && visibleProducts.length === 0 && (
                <p style={{ color: '#6b7280' }}>No products match your filters.</p>
              )}
              {!loading && !error && (
                <div className="product-grid">
                  {visibleProducts.map((product) => (
                    <div key={product.id} className="product-tile" onClick={() => openProduct(product.id)}>
                      <div className="product-image-wrap">
                        {product.images && product.images[0] && <img src={product.images[0]} alt={product.name} />}
                        <button
                          className={`wishlist-heart ${wishlistIds.includes(product.id) ? 'active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleWishlist(product.id) }}
                          aria-label="Toggle wishlist"
                        >
                          {wishlistIds.includes(product.id) ? '♥' : '♡'}
                        </button>
                      </div>
                      <div className="product-name">{product.name}</div>
                      <div className="product-price">${product.price.toFixed(2)}</div>
                      <div className="product-stock">{product.inStock ? `${product.stock} in stock` : 'Out of stock'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'product' && (
          <ProductDetail
            productId={selectedProductId}
            token={token}
            onAddToCart={addToCart}
            onBack={() => setView('products')}
            wishlistIds={wishlistIds}
            onToggleWishlist={toggleWishlist}
            onRequireLogin={() => setView('login')}
          />
        )}

        {view === 'wishlist' && (
          <WishlistView items={wishlistItems} onOpen={openProduct} onToggleWishlist={toggleWishlist} onBack={() => setView('products')} />
        )}

        {view === 'cart' && <CartView cart={cart} onUpdateQuantity={updateCartItem} onRemove={removeCartItem} onBack={() => setView('products')} onCheckout={() => setView('checkout')} />}
        {view === 'checkout' && <CheckoutForm cart={cart} onSubmit={startCheckout} onBack={() => setView('cart')} />}
        {view === 'orders' && <OrdersView token={token} />}
        {view === 'admin' && isAdmin && <AdminPanel token={token} onProductsChanged={loadProducts} />}
      </main>
    </div>
  )
}

function OrderSuccessView({ onViewOrders, onContinue }) {
  return (
    <div className="narrow status-view">
      <h2 style={{ marginBottom: '1rem' }}>Thank you — your order is confirmed!</h2>
      <p style={{ marginBottom: '1.5rem' }}>We've received your payment and we're getting your order ready.</p>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onViewOrders}>View my orders</button>
        <button className="btn" onClick={onContinue}>Continue shopping</button>
      </div>
    </div>
  )
}

function OrderCancelledView({ onBackToCart, onContinue }) {
  return (
    <div className="narrow status-view">
      <h2 style={{ marginBottom: '1rem' }}>Checkout cancelled</h2>
      <p style={{ marginBottom: '1.5rem' }}>No payment was made. Your cart is still saved, so you can try again whenever you're ready.</p>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onBackToCart}>Back to cart</button>
        <button className="btn" onClick={onContinue}>Continue shopping</button>
      </div>
    </div>
  )
}

function WishlistView({ items, onOpen, onToggleWishlist, onBack }) {
  return (
    <div className="medium">
      <button className="back-link" onClick={onBack}>&larr; Back to products</button>
      <h2 style={{ marginBottom: '1.5rem' }}>Your Wishlist</h2>
      {items.length === 0 && <p style={{ color: '#6b7280' }}>Nothing saved yet — tap the heart on any product to add it here.</p>}
      <div className="product-grid">
        {items.map((product) => (
          <div key={product.id} className="product-tile" onClick={() => onOpen(product.id)}>
            <div className="product-image-wrap">
              {product.images && product.images[0] && <img src={product.images[0]} alt={product.name} />}
              <button className="wishlist-heart active" onClick={(e) => { e.stopPropagation(); onToggleWishlist(product.id) }} aria-label="Remove from wishlist">♥</button>
            </div>
            <div className="product-name">{product.name}</div>
            <div className="product-price">${product.price.toFixed(2)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProductDetail({ productId, token, onAddToCart, onBack, wishlistIds, onToggleWishlist, onRequireLogin }) {
  const [product, setProduct] = useState(null)
  const [reviews, setReviews] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)

  function loadReviews() {
    fetch(`${API_URL}/api/products/${productId}/reviews`).then((r) => r.json()).then((data) => setReviews(data.data))
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API_URL}/api/products/${productId}`).then((r) => r.json()),
      fetch(`${API_URL}/api/products/${productId}/reviews`).then((r) => r.json())
    ]).then(([productData, reviewsData]) => {
      setProduct(productData); setReviews(reviewsData.data); setLoading(false)
    })
  }, [productId])

  if (loading) return <p>Loading...</p>
  if (!product) return <p>Product not found.</p>

  const inWishlist = wishlistIds.includes(product.id)

  return (
    <div className="wide">
      <button className="back-link" onClick={onBack}>&larr; Back to products</button>
      <div className="detail-layout">
        <div style={{ position: 'relative' }}>
          {product.images && product.images[0] && <img className="detail-image" src={product.images[0]} alt={product.name} />}
          <button
            className={`wishlist-heart detail ${inWishlist ? 'active' : ''}`}
            onClick={() => token ? onToggleWishlist(product.id) : onRequireLogin()}
            aria-label="Toggle wishlist"
          >
            {inWishlist ? '♥' : '♡'}
          </button>
        </div>
        <div>
          <h2>{product.name}</h2>
          <p>{product.description}</p>
          <p className="product-price">${product.price.toFixed(2)}</p>
          <p className="product-stock">{product.inStock ? `${product.stock} in stock` : 'Out of stock'}</p>
          {product.reviewCount > 0 && <p className="rating">★ {product.averageRating} · {product.reviewCount} review{product.reviewCount !== 1 ? 's' : ''}</p>}
          <div className="qty-row">
            <input type="number" min="1" max={product.stock} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="small-field" />
            <button className="btn btn-primary" disabled={!product.inStock} onClick={() => onAddToCart(product.id, quantity)}>Add to cart</button>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: '2.5rem', marginBottom: '0.5rem' }}>Reviews</h3>
      {reviews.length === 0 && <p style={{ color: '#6b7280' }}>No reviews yet.</p>}
      {reviews.map((review) => (
        <div key={review.id} className="review-row">
          <strong>{review.userName}</strong> — ★ {review.rating}
          {review.comment && <p>{review.comment}</p>}
        </div>
      ))}

      {token ? (
        <ReviewForm productId={productId} token={token} onSubmitted={loadReviews} />
      ) : (
        <p style={{ marginTop: '1rem' }}>
          <button className="btn-text" onClick={onRequireLogin}>Log in</button> to write a review.
        </p>
      )}
    </div>
  )
}

function ReviewForm({ productId, token, onSubmitted }) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    const res = await apiFetch(`${API_URL}/api/products/${productId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rating: Number(rating), comment })
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { if (res.status !== 401) setError(data.error); return }
    setComment(''); setDone(true)
    onSubmitted()
  }

  if (done) return <p style={{ marginTop: '1rem', color: '#6b7280' }}>Thanks for your review!</p>

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '1.5rem', maxWidth: '360px' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Write a review</h3>
      {error && <p className="error-text">{error}</p>}
      <select className="field" value={rating} onChange={(e) => setRating(e.target.value)}>
        <option value="5">★★★★★ (5)</option>
        <option value="4">★★★★☆ (4)</option>
        <option value="3">★★★☆☆ (3)</option>
        <option value="2">★★☆☆☆ (2)</option>
        <option value="1">★☆☆☆☆ (1)</option>
      </select>
      <textarea className="field" placeholder="Share your thoughts (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit review'}</button>
    </form>
  )
}

function CartView({ cart, onUpdateQuantity, onRemove, onBack, onCheckout }) {
  if (!cart) return <p>Loading cart...</p>

  return (
    <div className="medium">
      <button className="back-link" onClick={onBack}>&larr; Continue shopping</button>
      <h2 style={{ marginBottom: '1.5rem' }}>Your Cart</h2>
      {cart.items.length === 0 && <p style={{ color: '#6b7280' }}>Your cart is empty.</p>}
      {cart.items.map((item) => (
        <div key={item.productId} className="line-row">
          <div>
            <strong>{item.product.name}</strong>
            <p className="product-price">${item.product.price.toFixed(2)} each</p>
          </div>
          <div className="line-controls">
            <input type="number" min="1" max={item.product.stock} value={item.quantity} onChange={(e) => onUpdateQuantity(item.productId, Number(e.target.value))} className="small-field" />
            <span>${item.subtotal.toFixed(2)}</span>
            <button className="btn-text" onClick={() => onRemove(item.productId)}>Remove</button>
          </div>
        </div>
      ))}
      {cart.items.length > 0 && (
        <div className="cart-total-row">
          <h3>Total: ${cart.total.toFixed(2)}</h3>
          <button className="btn btn-primary" onClick={onCheckout}>Checkout</button>
        </div>
      )}
    </div>
  )
}

function CheckoutForm({ cart, onSubmit, onBack }) {
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    await onSubmit({ line1, city, postalCode, country }, couponCode.trim() || undefined)
    setSubmitting(false)
  }

  if (!cart || cart.items.length === 0) return <p>Your cart is empty.</p>

  return (
    <form onSubmit={handleSubmit} className="narrow">
      <button type="button" className="back-link" onClick={onBack}>&larr; Back to cart</button>
      <h2 style={{ marginBottom: '1.5rem' }}>Shipping details</h2>
      <input className="field" placeholder="Address" value={line1} onChange={(e) => setLine1(e.target.value)} required />
      <input className="field" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} required />
      <input className="field" placeholder="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
      <input className="field" placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} required />
      <input className="field" placeholder="Coupon code (optional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
      <h3 style={{ margin: '1.5rem 0' }}>Total: ${cart.total.toFixed(2)}</h3>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Redirecting to payment...' : 'Pay now'}
      </button>
    </form>
  )
}

// Always calls /api/orders/me, so this screen only ever shows the logged-in
// user's own order history — even for an admin account.
function OrdersView({ token }) {
  const [orders, setOrders] = useState(null)

  useEffect(() => {
    apiFetch(`${API_URL}/api/orders/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => setOrders(data.data))
  }, [token])

  if (!orders) return <p>Loading orders...</p>
  if (orders.length === 0) return <p style={{ color: '#6b7280' }}>You haven't placed any orders yet.</p>

  return (
    <div className="medium">
      <h2 style={{ marginBottom: '1.5rem' }}>Your Orders</h2>
      {orders.map((order) => (
        <div key={order.id} className="order-card">
          <p><strong>Order #{order.id.slice(0, 8)}</strong> — {order.status}</p>
          {order.items.map((item) => <p key={item.productId}>{item.quantity} × {item.name}</p>)}
          {order.couponCode && <p style={{ color: '#6b7280' }}>Coupon: {order.couponCode} (-${order.discount.toFixed(2)})</p>}
          <p><strong>Total: ${order.total.toFixed(2)}</strong></p>
        </div>
      ))}
    </div>
  )
}

function AdminPanel({ token, onProductsChanged }) {
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [refreshFlag, setRefreshFlag] = useState(0)

  function reload() { setRefreshFlag((n) => n + 1) }

  useEffect(() => {
    fetch(`${API_URL}/api/categories`).then((r) => r.json()).then(setCategories)
    fetch(`${API_URL}/api/products?limit=100`).then((r) => r.json()).then((data) => setProducts(data.data))
  }, [refreshFlag])

  const [tab, setTab] = useState('products')

  function afterChange() { reload(); onProductsChanged() }

  return (
    <div className="wide">
      <h2 style={{ marginBottom: '1rem' }}>Admin</h2>
      <div className="admin-tabs">
        <button className={`tab-btn ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>Products</button>
        <button className={`tab-btn ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>Orders</button>
        <button className={`tab-btn ${tab === 'coupons' ? 'active' : ''}`} onClick={() => setTab('coupons')}>Coupons</button>
        <button className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>Sales</button>
      </div>

      {tab === 'orders' && <AdminOrders token={token} />}
      {tab === 'coupons' && <AdminCoupons token={token} />}
      {tab === 'stats' && <AdminStats token={token} />}

      {tab === 'products' && (<>
      <section className="admin-section">
        <h3>Categories</h3>
        <ul className="category-list">{categories.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
        <NewCategoryForm token={token} onCreated={afterChange} />
      </section>

      <section className="admin-section">
        <h3>Add a product</h3>
        <NewProductForm token={token} categories={categories} onCreated={afterChange} />
      </section>

      <section className="admin-section">
        <h3>Existing products</h3>
        {products.map((p) => <AdminProductRow key={p.id} product={p} token={token} categories={categories} onChanged={afterChange} />)}
      </section>
      </>)}
    </div>
  )
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']

function AdminOrders({ token }) {
  const [orders, setOrders] = useState(null)
  const [pagination, setPagination] = useState(null)
  const [users, setUsers] = useState({})
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [error, setError] = useState(null)

  // Orders only carry a userId, so load users once to show names/emails.
  useEffect(() => {
    apiFetch(`${API_URL}/api/users?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        const map = {}
        for (const u of data.data || []) map[u.id] = u
        setUsers(map)
      })
      .catch(() => {})
  }, [token])

  useEffect(() => {
    setOrders(null)
    const statusParam = statusFilter ? `&status=${statusFilter}` : ''
    apiFetch(`${API_URL}/api/orders?limit=20&page=${page}&sortBy=${sortBy}${statusParam}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { setOrders(data.data); setPagination(data.pagination) })
      .catch(() => setError('Could not load orders.'))
  }, [token, statusFilter, sortBy, page])

  async function changeStatus(order, newStatus) {
    if (newStatus === order.status) return
    if (newStatus === 'cancelled' && !confirm('Cancel this order? Stock will be returned to inventory.')) return
    setError(null)
    const res = await apiFetch(`${API_URL}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: newStatus })
    })
    const data = await res.json()
    if (!res.ok) { if (res.status !== 401) setError(data.error || 'Could not update order'); return }
    setOrders((prev) => prev.map((o) => (o.id === order.id ? data : o)))
  }

  return (
    <div>
      <div className="results-bar">
        <span className="results-count">
          {pagination ? `${pagination.total} order${pagination.total !== 1 ? 's' : ''}` : ''}
        </span>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="total-desc">Total: High to Low</option>
            <option value="total-asc">Total: Low to High</option>
          </select>
          <select
            className="sort-select"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          >
            <option value="">All orders</option>
            <option value="awaiting_payment">Awaiting payment</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!orders && !error && <p>Loading orders...</p>}
      {orders && orders.length === 0 && <p style={{ color: '#6b7280' }}>No orders found.</p>}

      {orders && orders.map((order) => {
        const customer = users[order.userId]
        const addr = order.shippingAddress || {}
        // Unpaid checkouts can only be cancelled, never shipped.
        const options = order.status === 'awaiting_payment' ? ['cancelled'] : ORDER_STATUSES
        return (
          <div key={order.id} className="order-card">
            <div className="admin-order-head">
              <div>
                <strong>Order #{order.id.slice(0, 8)}</strong>
                <span className="admin-order-meta"> · {new Date(order.createdAt).toLocaleString()}</span>
              </div>
              <span className={`pay-badge ${order.paymentStatus === 'paid' ? 'paid' : ''}`}>{order.paymentStatus}</span>
            </div>
            <p className="admin-order-meta">
              {customer ? `${customer.name} (${customer.email})` : `Customer ${order.userId.slice(0, 8)}`}
            </p>
            {order.items.map((item) => <p key={item.productId}>{item.quantity} × {item.name}</p>)}
            {order.couponCode && <p className="admin-order-meta">Coupon {order.couponCode}: -${order.discount.toFixed(2)}</p>}
            <p><strong>Total: ${order.total.toFixed(2)}</strong></p>
            <p className="admin-order-meta">Ship to: {addr.line1}, {addr.city}, {addr.postalCode}, {addr.country}</p>
            <div className="admin-order-status">
              <span>Status</span>
              <select
                className="sort-select"
                value={order.status}
                disabled={order.status === 'cancelled'}
                onChange={(e) => changeStatus(order, e.target.value)}
              >
                {!options.includes(order.status) && (
                  <option value={order.status} disabled>{order.status.replace('_', ' ')}</option>
                )}
                {options.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )
      })}

      {pagination && pagination.pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pagination.pages}</span>
          <button className="btn" disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

function AdminCoupons({ token }) {
  const [coupons, setCoupons] = useState(null)
  const [code, setCode] = useState('')
  const [type, setType] = useState('percent')
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const auth = { Authorization: `Bearer ${token}` }

  function load() {
    apiFetch(`${API_URL}/api/coupons`, { headers: auth })
      .then((r) => r.json())
      .then((d) => setCoupons(Array.isArray(d) ? d : d.data || []))
      .catch(() => setError('Could not load coupons.'))
  }
  useEffect(load, [token])

  async function create(e) {
    e.preventDefault(); setError(null)
    const { ok, data } = await postJson('/api/coupons', { code: code.trim().toUpperCase(), type, value: Number(value) }, token)
    if (!ok) { setError(data.error || 'Could not create coupon'); return }
    setCode(''); setValue(''); load()
  }

  async function remove(c) {
    if (!confirm(`Delete coupon ${c.code}?`)) return
    await apiFetch(`${API_URL}/api/coupons/${c.id}`, { method: 'DELETE', headers: auth })
    load()
  }

  return (
    <div>
      <section className="admin-section">
        <h3>Create a coupon</h3>
        {error && <p className="error-text">{error}</p>}
        <form onSubmit={create} className="narrow">
          <input className="field" placeholder="Code (e.g. WELCOME10)" value={code} onChange={(e) => setCode(e.target.value)} required />
          <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed amount off</option>
          </select>
          <input
            className="field" type="number" step="0.01" min="0"
            placeholder={type === 'percent' ? 'Percent (e.g. 10)' : 'Amount (e.g. 5.00)'}
            value={value} onChange={(e) => setValue(e.target.value)} required
          />
          <button type="submit" className="btn btn-primary">Create coupon</button>
        </form>
      </section>

      <section className="admin-section">
        <h3>Existing coupons</h3>
        {!coupons && !error && <p>Loading...</p>}
        {coupons && coupons.length === 0 && <p style={{ color: '#6b7280' }}>No coupons yet.</p>}
        {coupons && coupons.map((c) => (
          <div key={c.id} className="admin-row">
            <div><strong>{c.code}</strong> — {c.type === 'percent' ? `${c.value}% off` : `$${Number(c.value).toFixed(2)} off`}</div>
            <button className="btn-text" onClick={() => remove(c)}>Delete</button>
          </div>
        ))}
      </section>
    </div>
  )
}

function AdminStats({ token }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`${API_URL}/api/orders?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setOrders(d.data))
      .catch(() => setError('Could not load orders.'))
  }, [token])

  if (error) return <p className="error-text">{error}</p>
  if (!orders) return <p>Loading stats...</p>

  const sold = orders.filter((o) => o.paymentStatus === 'paid' && o.status !== 'cancelled')
  const revenue = sold.reduce((s, o) => s + o.total, 0)
  const discounts = sold.reduce((s, o) => s + (o.discount || 0), 0)
  const byProduct = {}
  for (const o of sold) {
    for (const i of o.items) {
      if (!byProduct[i.productId]) byProduct[i.productId] = { name: i.name, qty: 0 }
      byProduct[i.productId].qty += i.quantity
    }
  }
  const top = Object.values(byProduct).sort((a, b) => b.qty - a.qty).slice(0, 5)

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">${revenue.toFixed(2)}</div></div>
        <div className="stat-card"><div className="stat-label">Paid orders</div><div className="stat-value">{sold.length}</div></div>
        <div className="stat-card"><div className="stat-label">Avg order</div><div className="stat-value">${sold.length ? (revenue / sold.length).toFixed(2) : '0.00'}</div></div>
        <div className="stat-card"><div className="stat-label">Coupon discounts</div><div className="stat-value">${discounts.toFixed(2)}</div></div>
      </div>
      <section className="admin-section">
        <h3>Top sellers</h3>
        {top.length === 0 && <p style={{ color: '#6b7280' }}>No paid orders yet.</p>}
        {top.map((p) => (
          <div key={p.name} className="admin-row"><span>{p.name}</span><strong>{p.qty} sold</strong></div>
        ))}
      </section>
    </div>
  )
}

function NewCategoryForm({ token, onCreated }) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    const res = await apiFetch(`${API_URL}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name })
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { if (res.status !== 401) setError(data.error); return }
    setName(''); onCreated()
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="field" style={{ marginBottom: 0, width: '220px' }} placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} required />
      <button type="submit" className="btn" disabled={submitting}>Add category</button>
      {error && <span className="error-text" style={{ marginBottom: 0 }}>{error}</span>}
    </form>
  )
}

function NewProductForm({ token, categories, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      let images = []
      if (imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        const uploadRes = await apiFetch(`${API_URL}/api/admin/upload-image`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData
        })
        const uploadData = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Image upload failed')
        images = [uploadData.url]
      }
      const res = await apiFetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, description, price: Number(price), category, stock: Number(stock), images })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create product')
      setName(''); setDescription(''); setPrice(''); setCategory(''); setStock(''); setImageFile(null)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="narrow">
      {error && <p className="error-text">{error}</p>}
      <input className="field" placeholder="Product name" value={name} onChange={(e) => setName(e.target.value)} required />
      <textarea className="field" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} required />
      <input className="field" type="number" step="0.01" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} required />
      <select className="field" value={category} onChange={(e) => setCategory(e.target.value)} required>
        <option value="">Select category</option>
        {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
      </select>
      <input className="field" type="number" placeholder="Stock quantity" value={stock} onChange={(e) => setStock(e.target.value)} required />
      <input style={{ marginBottom: '1rem' }} type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating...' : 'Create product'}</button>
    </form>
  )
}

function AdminProductRow({ product, token, categories, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState(product.price)
  const [stock, setStock] = useState(product.stock)
  const [category, setCategory] = useState(product.category)
  const [submitting, setSubmitting] = useState(false)

  async function saveEdit() {
    setSubmitting(true)
    await apiFetch(`${API_URL}/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, price: Number(price), stock: Number(stock), category })
    })
    setSubmitting(false); setEditing(false); onChanged()
  }

  async function deactivate() {
    if (!confirm(`Deactivate "${product.name}"? It will no longer show in the store.`)) return
    await apiFetch(`${API_URL}/api/products/${product.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    onChanged()
  }

  if (editing) {
    return (
      <div className="admin-edit-box">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        <input className="field" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={saveEdit} disabled={submitting}>Save</button>
        <button className="btn-text" style={{ marginLeft: '1rem' }} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    )
  }

  return (
    <div className="admin-row">
      <div>{product.name} — ${product.price.toFixed(2)} — {product.stock} in stock — {product.category}</div>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button className="btn-text" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn-text" onClick={deactivate}>Deactivate</button>
      </div>
    </div>
  )
}

function LoginForm({ onSuccess, onSwitch, onForgot }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      onSuccess(data)
    } catch (err) { setError(err.message) } finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="narrow">
      <h2 style={{ marginBottom: '1.5rem' }}>Log in</h2>
      {error && <p className="error-text">{error}</p>}
      <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="field" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Logging in...' : 'Log in'}</button>
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <button type="button" className="btn-text" onClick={onForgot}>Forgot password?</button>
      </p>
      <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#6b7280' }}>
        Don't have an account? <button type="button" className="btn-text" onClick={onSwitch}>Sign up</button>
      </p>
    </form>
  )
}

function RegisterForm({ onSuccess, onSwitch }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      onSuccess(data)
    } catch (err) { setError(err.message) } finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="narrow">
      <h2 style={{ marginBottom: '1.5rem' }}>Sign up</h2>
      {error && <p className="error-text">{error}</p>}
      <input className="field" type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="field" type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Signing up...' : 'Sign up'}</button>
      <p style={{ marginTop: '1.25rem', fontSize: '0.9rem', color: '#6b7280' }}>
        Already have an account? <button type="button" className="btn-text" onClick={onSwitch}>Log in</button>
      </p>
    </form>
  )
}

function ForgotForm({ onBack }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true)
    await postJson('/api/auth/forgot-password', { email })
    setSubmitting(false); setSent(true)
  }

  if (sent) {
    return (
      <div className="narrow">
        <h2 style={{ marginBottom: '1rem' }}>Check your email</h2>
        <p>If an account exists for {email}, a reset link is on its way.</p>
        <button className="btn-text" onClick={onBack}>Back to log in</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="narrow">
      <h2 style={{ marginBottom: '1.5rem' }}>Forgot password</h2>
      <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Sending...' : 'Send reset link'}</button>
      <p style={{ marginTop: '1.25rem' }}>
        <button type="button" className="btn-text" onClick={onBack}>Back to log in</button>
      </p>
    </form>
  )
}

function ResetForm({ resetToken, onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setError(null); setSubmitting(true)
    const { ok, data } = await postJson('/api/auth/reset-password', { token: resetToken, password })
    setSubmitting(false)
    if (!ok) { setError(data.error || 'Reset failed. The link may have expired.'); return }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="narrow">
        <h2 style={{ marginBottom: '1rem' }}>Password updated</h2>
        <button className="btn btn-primary" onClick={onDone}>Log in</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="narrow">
      <h2 style={{ marginBottom: '1.5rem' }}>Choose a new password</h2>
      {error && <p className="error-text">{error}</p>}
      <input className="field" type="password" placeholder="New password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Reset password'}</button>
    </form>
  )
}

function ChangePasswordForm({ token }) {
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setError(null); setDone(false); setSubmitting(true)
    const { ok, data } = await postJson('/api/auth/change-password', { currentPassword, newPassword }, token)
    setSubmitting(false)
    if (!ok) { setError(data.error || 'Could not change password'); return }
    setCurrent(''); setNew(''); setDone(true)
  }

  return (
    <form onSubmit={handleSubmit} className="narrow">
      <h2 style={{ marginBottom: '1.5rem' }}>Change password</h2>
      {error && <p className="error-text">{error}</p>}
      {done && <p style={{ color: '#2e7d32', marginBottom: '0.75rem' }}>Password changed.</p>}
      <input className="field" type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
      <input className="field" type="password" placeholder="New password (min 8 characters)" value={newPassword} onChange={(e) => setNew(e.target.value)} minLength={8} required />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Change password'}</button>
    </form>
  )
}

export default App