/* eslint-disable no-magic-numbers */
import { defineStore } from 'pinia'
import axios from 'axios'
import { ref, computed } from 'vue'
import router from '@/router'
import type { SampleRequest, SampleResponse } from '@/types'

axios.interceptors.response.use(null, (error) => {
  const url: string = error.config?.url ?? ''
  const isAuthEndpoint = url.includes('/auth/login') || url.includes('/hook/auth')
  if (error.response?.status === 401 && !isAuthEndpoint) {
    router.push({ name: 'login' })
  }
  return Promise.reject(error)
})

axios.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

export const useApp = defineStore('App', () => {
  const jwt = ref('')
  const apiUrl = ref('')
  const eliseUrl = ref('')
  const loading = ref(false)
  const mustChangePassword = ref(false)

  const fetchApiUrl = async () => {
    const { data } = await axios.get(import.meta.env.BASE_URL + 'config.json?_=' + Date.now())
    apiUrl.value = (data.GLB_API_URL as string).replace(/\/+$/, '')
    eliseUrl.value = data.GLB_ELISE_URL
  }
  const fetchJwt = async (guid: string) => {
    try {
      const response = await axios.get(apiUrl.value + '/hook/auth', { params: { guid } })
      jwt.value = response.data.jwt
    } catch (error) {
      throw error
    }
  }
  /**
   * Login step 1.
   * Returns { jwt, mustChangePassword } on success without TOTP,
   * or { requiresTotp: true, tempToken } when 2FA is required.
   */
  const login = async (
    email: string,
    password: string,
  ): Promise<{ requiresTotp?: boolean; tempToken?: string }> => {
    const response = await axios.post(apiUrl.value + '/auth/login', { email, password })
    if (response.data.requiresTotp) {
      return { requiresTotp: true, tempToken: response.data.tempToken }
    }
    jwt.value = response.data.jwt
    mustChangePassword.value = response.data.mustChangePassword ?? false
    return {}
  }

  /**
   * Login step 2 — complete TOTP challenge.
   */
  const loginTotp = async (tempToken: string, code: string): Promise<void> => {
    const response = await axios.post(apiUrl.value + '/auth/login/totp', { tempToken, code })
    jwt.value = response.data.jwt
    mustChangePassword.value = response.data.mustChangePassword ?? false
  }

  const logout = async () => {
    jwt.value = ''
    mustChangePassword.value = false
    try {
      await axios.get(apiUrl.value + '/hook/logout')
    } catch {
      // ignore — we've already cleared the local JWT
    }
  }

  const storeGuidDevMode = async (guid: string) => {
    try {
      await axios.post(apiUrl.value + '/hook/storeNewGuid', {
        parameters: {
          instance: 'GED',
          documentsId: 'COURRIERS_515',
          user: 'AdminGED',
          userLogin: 'AdminGED',
          userDisplayName: 'AdminGED',
          userMail: 'AdminGED',
          guid
        }
      })
    } catch (error) {
      throw error
    }
  }

  const authHeader = () =>
    jwt.value ? { Authorization: `Bearer ${jwt.value}` } : {}

  // Decode role from JWT payload (no library needed — just base64 decode)
  const userRole = computed<string | null>(() => {
    if (!jwt.value) return null
    try {
      const payload = JSON.parse(atob(jwt.value.split('.')[1]))
      // ASP.NET Core stores role in ClaimTypes.Role key
      return (
        payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ??
        payload['role'] ??
        null
      )
    } catch {
      return null
    }
  })

  const setLoading = (_loading: boolean) => {
    loading.value = _loading
  }

  /*
    custom action
  */
  const getSample = async () => {
    try {
      const { data }: { data: SampleResponse } = await axios.get(
        apiUrl.value + '/EliseInteraction/Sample'
      )
      return data
    } catch (error) {
      throw error
    }
  }

  const updateSample = async (payload: SampleRequest) => {
    try {
      const { data }: { data: SampleResponse } = await axios.post(
        apiUrl.value + '/EliseInteraction/Sample',
        payload
      )
      return data
    } catch (error) {
      throw error
    }
  }
  return {
    jwt,
    apiUrl,
    loading,
    mustChangePassword,
    userRole,
    authHeader,
    fetchApiUrl,
    fetchJwt,
    login,
    loginTotp,
    storeGuidDevMode,
    logout,
    setLoading,
    getSample,
    updateSample
  }
})
