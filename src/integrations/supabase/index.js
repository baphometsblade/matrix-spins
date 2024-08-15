import { createClient } from '@supabase/supabase-js';
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const supabaseUrl = import.meta.env.VITE_SUPABASE_PROJECT_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_API_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

import React from "react";
export const queryClient = new QueryClient();
export function SupabaseProvider({ children }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const fromSupabase = async (query) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
};

/* supabase integration types

### generated_images

| name       | type                     | format | required |
|------------|--------------------------|--------|----------|
| id         | int8                     | number | true     |
| created_at | timestamp with time zone | string | true     |

### card_images

| name       | type                     | format | required |
|------------|--------------------------|--------|----------|
| id         | int8                     | number | true     |
| created_at | timestamp with time zone | string | true     |

### a

| name       | type                     | format | required |
|------------|--------------------------|--------|----------|
| id         | int8                     | number | true     |
| created_at | timestamp with time zone | string | true     |

*/

// Hooks for generated_images
export const useGeneratedImages = () => useQuery({
    queryKey: ['generated_images'],
    queryFn: () => fromSupabase(supabase.from('generated_images').select('*')),
});

export const useGeneratedImage = (id) => useQuery({
    queryKey: ['generated_images', id],
    queryFn: () => fromSupabase(supabase.from('generated_images').select('*').eq('id', id).single()),
});

export const useAddGeneratedImage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (newImage) => fromSupabase(supabase.from('generated_images').insert([newImage])),
        onSuccess: () => {
            queryClient.invalidateQueries('generated_images');
        },
    });
};

export const useUpdateGeneratedImage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updateData }) => fromSupabase(supabase.from('generated_images').update(updateData).eq('id', id)),
        onSuccess: () => {
            queryClient.invalidateQueries('generated_images');
        },
    });
};

export const useDeleteGeneratedImage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => fromSupabase(supabase.from('generated_images').delete().eq('id', id)),
        onSuccess: () => {
            queryClient.invalidateQueries('generated_images');
        },
    });
};

// Hooks for card_images
export const useCardImages = () => useQuery({
    queryKey: ['card_images'],
    queryFn: () => fromSupabase(supabase.from('card_images').select('*')),
});

export const useCardImage = (id) => useQuery({
    queryKey: ['card_images', id],
    queryFn: () => fromSupabase(supabase.from('card_images').select('*').eq('id', id).single()),
});

export const useAddCardImage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (newImage) => fromSupabase(supabase.from('card_images').insert([newImage])),
        onSuccess: () => {
            queryClient.invalidateQueries('card_images');
        },
    });
};

export const useUpdateCardImage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updateData }) => fromSupabase(supabase.from('card_images').update(updateData).eq('id', id)),
        onSuccess: () => {
            queryClient.invalidateQueries('card_images');
        },
    });
};

export const useDeleteCardImage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => fromSupabase(supabase.from('card_images').delete().eq('id', id)),
        onSuccess: () => {
            queryClient.invalidateQueries('card_images');
        },
    });
};

// Hooks for a
export const useAs = () => useQuery({
    queryKey: ['a'],
    queryFn: () => fromSupabase(supabase.from('a').select('*')),
});

export const useA = (id) => useQuery({
    queryKey: ['a', id],
    queryFn: () => fromSupabase(supabase.from('a').select('*').eq('id', id).single()),
});

export const useAddA = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (newA) => fromSupabase(supabase.from('a').insert([newA])),
        onSuccess: () => {
            queryClient.invalidateQueries('a');
        },
    });
};

export const useUpdateA = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updateData }) => fromSupabase(supabase.from('a').update(updateData).eq('id', id)),
        onSuccess: () => {
            queryClient.invalidateQueries('a');
        },
    });
};

export const useDeleteA = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => fromSupabase(supabase.from('a').delete().eq('id', id)),
        onSuccess: () => {
            queryClient.invalidateQueries('a');
        },
    });
};